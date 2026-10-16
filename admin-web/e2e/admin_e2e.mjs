// E2E web Admin: đăng nhập -> bật 2FA -> đổi mật khẩu tạm -> chụp các trang -> khóa 1 tài khoản qua giao diện.
// node admin_e2e.mjs <user> <temp_password> <out_dir> [dark]
import puppeteer from 'puppeteer-core'
import crypto from 'node:crypto'

const [, , USER, TEMP, OUT = './shots', DARK] = process.argv
import fs from 'node:fs'
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:8080/admin'

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/\s/g, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const h = crypto.createHmac('sha1', key).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: DARK ? 'dark' : 'light' }])
await page.setViewport({ width: 1440, height: 900 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const shot = (n) => page.screenshot({ path: `${OUT}/${n}${DARK ? '_dark' : ''}.png` })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clickText = async (text) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t && !b.disabled)
    if (el) el.click()
    return !!el
  }, text)
  if (!ok) throw new Error('Không thấy nút: ' + text)
}

await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
await shot('01_login')
await page.type('input[autocomplete=username]', USER)
await page.type('input[autocomplete=current-password]', TEMP)
await clickText('Đăng nhập')
await page.waitForSelector('img[alt="Mã QR thiết lập 2FA"]')
await wait(300)
await shot('02_enroll')
const secret = await page.$eval('code', (c) => c.textContent)
await page.type('input[autocomplete=one-time-code]', totp(secret))
await clickText('Bật 2FA')
await page.waitForFunction(() => document.body.innerText.includes('Đặt mật khẩu mới'))
const NEWPW = 'Mat-khau-e2e-' + Date.now()
const pws = await page.$$('input[type=password]')
await pws[0].type(TEMP)
await pws[1].type(NEWPW)
await pws[2].type(NEWPW)
await clickText('Lưu và tiếp tục')
await page.waitForFunction(() => document.body.innerText.includes('Tổng tài khoản'))
await wait(1500)
await shot('03_dashboard')

await page.goto(BASE + '/accounts', { waitUntil: 'networkidle0' })
await shot('04_accounts')
const first = await page.$eval('tbody a', (a) => a.getAttribute('href'))
await page.goto('http://localhost:8080' + first, { waitUntil: 'networkidle0' })
await shot('05_account_detail')
await clickText('Khóa tài khoản')
await page.waitForSelector('textarea')
await clickText('3 ngày')
await page.type('textarea', 'Kiểm tra giao diện tự động')
await shot('06_ban_dialog')
await clickText('Khóa')
await page.waitForFunction(() => document.body.innerText.includes('Khóa có hạn'))
await wait(400)
await shot('07_account_banned')
await clickText('Mở khóa tài khoản')
await page.waitForSelector('textarea')
await page.type('textarea', 'Kiểm tra giao diện tự động')
await clickText('Mở khóa')
await page.waitForFunction(() => !document.body.innerText.includes('Khóa có hạn'))

for (const [p, n] of [['punishments', '08_punishments'], ['servers', '09_servers'], ['audit', '10_audit'], ['admins', '11_admins'], ['profile', '12_profile']]) {
  await page.goto(`${BASE}/${p}`, { waitUntil: 'networkidle0' })
  await wait(300)
  await shot(n)
}
await page.setViewport({ width: 390, height: 844 })
await page.goto(BASE + '/accounts', { waitUntil: 'networkidle0' })
await shot('13_mobile_accounts')

console.log('E2E_OK', errors.length ? 'LỖI CONSOLE: ' + errors.join(' | ') : 'không có lỗi console')
await browser.close()
