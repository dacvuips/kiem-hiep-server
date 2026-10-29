package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	errRedisNil      = errors.New("redis: key not found")
	errRedisClosed   = errors.New("redis: client closed")
	errRedisNoConn   = errors.New("redis: no connection available")
)

// redisClient là client Redis đơn giản dựa trên giao thức RESP tiêu chuẩn (RESP2).
// Hoàn toàn dùng thư viện chuẩn Go (net/bufio), không tạo thêm phụ thuộc bên thứ 3 (go.mod sạch sẽ).
type redisClient struct {
	addr     string
	password string
	db       int
	pool     chan net.Conn
	mu       sync.Mutex
	closed   bool
}

// newRedisClient tạo client Redis từ chuỗi kết nối (VD: redis://redis:6379 hoặc 127.0.0.1:6379)
func newRedisClient(rawURL string) (*redisClient, error) {
	addr := strings.TrimSpace(rawURL)
	if addr == "" {
		return nil, errors.New("redis url is empty")
	}

	var password string
	var db int

	if strings.HasPrefix(addr, "redis://") {
		u, err := url.Parse(addr)
		if err != nil {
			return nil, fmt.Errorf("parse redis url: %w", err)
		}
		addr = u.Host
		if !strings.Contains(addr, ":") {
			addr += ":6379"
		}
		if u.User != nil {
			password, _ = u.User.Password()
		}
		path := strings.TrimPrefix(u.Path, "/")
		if path != "" {
			if n, err := strconv.Atoi(path); err == nil {
				db = n
			}
		}
	} else if !strings.Contains(addr, ":") {
		addr += ":6379"
	}

	c := &redisClient{
		addr:     addr,
		password: password,
		db:       db,
		pool:     make(chan net.Conn, 16),
	}

	// Kiểm tra kết nối thử
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conn, err := c.acquire(ctx)
	if err != nil {
		return nil, err
	}
	c.release(conn)

	return c, nil
}

func (c *redisClient) acquire(ctx context.Context) (net.Conn, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, errRedisClosed
	}
	c.mu.Unlock()

	select {
	case conn := <-c.pool:
		return conn, nil
	default:
		d := net.Dialer{Timeout: 3 * time.Second}
		conn, err := d.DialContext(ctx, "tcp", c.addr)
		if err != nil {
			return nil, err
		}
		if c.password != "" {
			if err := c.execAuth(conn, c.password); err != nil {
				conn.Close()
				return nil, err
			}
		}
		if c.db != 0 {
			if err := c.execSelect(conn, c.db); err != nil {
				conn.Close()
				return nil, err
			}
		}
		return conn, nil
	}
}

func (c *redisClient) release(conn net.Conn) {
	if conn == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		conn.Close()
		return
	}
	select {
	case c.pool <- conn:
	default:
		conn.Close()
	}
}

func (c *redisClient) execAuth(conn net.Conn, pass string) error {
	cmd := fmt.Sprintf("*2\r\n$4\r\nAUTH\r\n$%d\r\n%s\r\n", len(pass), pass)
	if _, err := conn.Write([]byte(cmd)); err != nil {
		return err
	}
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	if !strings.HasPrefix(line, "+OK") {
		return fmt.Errorf("auth error: %s", strings.TrimSpace(line))
	}
	return nil
}

func (c *redisClient) execSelect(conn net.Conn, db int) error {
	dbStr := strconv.Itoa(db)
	cmd := fmt.Sprintf("*2\r\n$6\r\nSELECT\r\n$%d\r\n%s\r\n", len(dbStr), dbStr)
	if _, err := conn.Write([]byte(cmd)); err != nil {
		return err
	}
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	if !strings.HasPrefix(line, "+OK") {
		return fmt.Errorf("select db error: %s", strings.TrimSpace(line))
	}
	return nil
}

// execute thực thi một lệnh RESP và trả về kết quả
func (c *redisClient) execute(ctx context.Context, args ...string) (any, error) {
	conn, err := c.acquire(ctx)
	if err != nil {
		return nil, err
	}

	// Định dạng lệnh RESP: *<count>\r\n$<len>\r\n<arg>\r\n...
	var buf strings.Builder
	buf.WriteString(fmt.Sprintf("*%d\r\n", len(args)))
	for _, arg := range args {
		buf.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(arg), arg))
	}

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	}

	if _, err := conn.Write([]byte(buf.String())); err != nil {
		conn.Close()
		return nil, err
	}

	reader := bufio.NewReader(conn)
	res, err := readRESP(reader)
	if err != nil {
		conn.Close()
		return nil, err
	}

	_ = conn.SetDeadline(time.Time{})
	c.release(conn)
	return res, nil
}

func readRESP(r *bufio.Reader) (any, error) {
	b, err := r.ReadByte()
	if err != nil {
		return nil, err
	}
	switch b {
	case '+': // Simple string
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		return strings.TrimRight(line, "\r\n"), nil
	case '-': // Error
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		return nil, errors.New(strings.TrimRight(line, "\r\n"))
	case ':': // Integer
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		return strconv.ParseInt(strings.TrimRight(line, "\r\n"), 10, 64)
	case '$': // Bulk string
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		length, err := strconv.Atoi(strings.TrimRight(line, "\r\n"))
		if err != nil {
			return nil, err
		}
		if length < 0 {
			return nil, errRedisNil
		}
		buf := make([]byte, length+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		return string(buf[:length]), nil
	case '*': // Array
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		count, err := strconv.Atoi(strings.TrimRight(line, "\r\n"))
		if err != nil {
			return nil, err
		}
		if count < 0 {
			return nil, errRedisNil
		}
		items := make([]any, count)
		for i := 0; i < count; i++ {
			item, err := readRESP(r)
			if err != nil && !errors.Is(err, errRedisNil) {
				return nil, err
			}
			items[i] = item
		}
		return items, nil
	default:
		return nil, fmt.Errorf("unknown resp type byte: %q", b)
	}
}

// Ping kiểm tra kết nối
func (c *redisClient) Ping(ctx context.Context) error {
	res, err := c.execute(ctx, "PING")
	if err != nil {
		return err
	}
	if s, ok := res.(string); ok && s == "PONG" {
		return nil
	}
	return fmt.Errorf("unexpected ping response: %v", res)
}

// Get lấy giá trị chuỗi theo khoá
func (c *redisClient) Get(ctx context.Context, key string) (string, error) {
	res, err := c.execute(ctx, "GET", key)
	if err != nil {
		return "", err
	}
	if s, ok := res.(string); ok {
		return s, nil
	}
	return "", errRedisNil
}

// Set lưu giá trị có thời hạn sống (TTL)
func (c *redisClient) Set(ctx context.Context, key, val string, ttl time.Duration) error {
	secs := int(ttl.Seconds())
	if secs <= 0 {
		secs = 1
	}
	_, err := c.execute(ctx, "SET", key, val, "EX", strconv.Itoa(secs))
	return err
}

// Del xóa khoá
func (c *redisClient) Del(ctx context.Context, key string) error {
	_, err := c.execute(ctx, "DEL", key)
	return err
}

// Close đóng các kết nối
func (c *redisClient) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	close(c.pool)
	for conn := range c.pool {
		conn.Close()
	}
}
