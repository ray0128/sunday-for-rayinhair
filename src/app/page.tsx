import styles from "./page.module.css";

export default function Home() {
  const devLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>美髮店動態排假管理系統（MVP）</h1>
        <div className={styles.ctas}>
          <a className={styles.primary} href="/api/auth/line/login">
            使用 LINE 登入
          </a>
          {devLoginEnabled ? (
            <a className={styles.primary} href="/dev/login">
              開始測試（模擬登入）
            </a>
          ) : null}
          <a className={styles.secondary} href="/leave">
            員工端（日曆）
          </a>
          <a className={styles.secondary} href="/admin">
            管理後台
          </a>
        </div>
      </main>
    </div>
  );
}
