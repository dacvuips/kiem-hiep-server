package main

import (
	"log"
	"time"
)

// TẠM THỜI — chẩn đoán lỗi "Mã xác thực không đúng": in giờ server, bước thời gian và mã server đang chấp nhận.
// Có ghi mã còn hiệu lực vào log: gỡ file này và lời gọi debugTOTP ngay sau khi xong.
func debugTOTP(where, secret, got string, lastStep int64) {
	now := time.Now()
	cur := now.Unix() / totpPeriod
	log.Printf("totp-debug %s: utc=%s step=%d lastStep=%d nhập=%q secretLen=%d", where, now.UTC().Format(time.RFC3339), cur, lastStep, got, len(secret))
	for _, d := range []int64{-1, 0, 1} {
		c, err := totpCode(secret, cur+d)
		log.Printf("totp-debug %s: step%+d mong đợi=%s err=%v", where, d, c, err)
	}
}
