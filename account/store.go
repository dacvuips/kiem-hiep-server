package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

func openDB(ctx context.Context, url string) (*pgxpool.Pool, error) {
	var lastErr error
	// Postgres trong Docker có thể chưa sẵn sàng ngay khi service này khởi động.
	for i := 0; i < 30; i++ {
		pool, err := pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool, nil
			}
			pool.Close()
		}
		lastErr = err
		time.Sleep(time.Second)
	}
	return nil, lastErr
}

// migrate chạy các file migrations/*.sql chưa chạy, theo thứ tự tên file, mỗi file trong 1 transaction.
func migrate(ctx context.Context, db *pgxpool.Pool) error {
	if _, err := db.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	names, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var done bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)`, name).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		sql, _ := migrationFS.ReadFile(name)
		tx, err := db.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(name) VALUES ($1)`, name); err != nil {
			tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		log.Printf("migrate: %s", name)
	}
	return nil
}

// bootstrapAdmin tạo Super Admin đầu tiên nếu chưa có admin nào.
func bootstrapAdmin(ctx context.Context, db *pgxpool.Pool, keys *keyring, user, pass string) error {
	if user == "" || pass == "" {
		return nil
	}
	var n int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM admins`).Scan(&n); err != nil || n > 0 {
		return err
	}
	hash, err := keys.hashPassword(pass)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `INSERT INTO admins(username, display_name, password_hash, role) VALUES ($1, $1, $2, 'super')`, user, hash)
	if err == nil {
		log.Printf("đã tạo Super Admin %q — hãy đổi mật khẩu và bật 2FA ngay", user)
	}
	return err
}
