package main

import (
	"fmt"
	"mime"
	"net/smtp"
	"strings"
	"time"
)

type mailer struct {
	addr string
	auth smtp.Auth
	from string
}

func newMailer(c Config) *mailer {
	m := &mailer{addr: fmt.Sprintf("%s:%d", c.SMTPHost, c.SMTPPort), from: c.MailFrom}
	if c.SMTPUser != "" {
		m.auth = smtp.PlainAuth("", c.SMTPUser, c.SMTPPass, c.SMTPHost)
	}
	return m
}

func (m *mailer) send(to, subject, body string) error {
	fromAddr := m.from
	if i := strings.LastIndex(fromAddr, "<"); i >= 0 {
		fromAddr = strings.Trim(fromAddr[i:], "<>")
	}
	msg := "From: " + encodeFrom(m.from) + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n" +
		"Date: " + time.Now().Format(time.RFC1123Z) + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n" +
		"Content-Transfer-Encoding: 8bit\r\n\r\n" + body
	return smtp.SendMail(m.addr, m.auth, fromAddr, []string{to}, []byte(msg))
}

func encodeFrom(from string) string {
	i := strings.LastIndex(from, "<")
	if i <= 0 {
		return from
	}
	return mime.QEncoding.Encode("utf-8", strings.TrimSpace(from[:i])) + " " + from[i:]
}

func (m *mailer) sendResetCode(to, username, code string, ttl time.Duration) error {
	body := fmt.Sprintf(`Xin chào %s,

Mã đặt lại mật khẩu của bạn là: %s

Mã có hiệu lực trong %d phút. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua thư này — mật khẩu của bạn vẫn giữ nguyên.

Kiếm Hiệp`, username, code, int(ttl.Minutes()))
	return m.send(to, "Mã đặt lại mật khẩu Kiếm Hiệp", body)
}
