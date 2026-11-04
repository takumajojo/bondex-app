// ESLint フラット設定 (Next.js 16 / ESLint 9)。Phase 0 (2026-11-04) で整備。
// eslint-config-next 16 はフラット設定の配列 (core-web-vitals + typescript を含む) をそのまま export するため、
// FlatCompat を介さず直接 spread する。ルールの無条件無効化は行わない。
// ignores は生成物・ビルド成果物・依存のみ (ソースは除外しない)。
import next from "eslint-config-next"

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "public/**",
      // 自動生成物 (手書きではないため lint 対象外)。
      "lib/voucher-icons.generated.ts",
      // ソースではないバックアップファイル (eslint が binary と誤判定する)。本来リポジトリ外が望ましい。
      "route_backup.ts",
    ],
  },
  ...next,
  // Phase 0 (2026-11-04): React Compiler 系の診断ルールを一時的に warn へ降格する。
  // eslint-config-next 16 が react-hooks v7 (React Compiler) の診断を既定で error 化し、
  // 既存コードに 71 件のエラーが出るため、lint を CI 必須ゲートにできない。
  // ルールは無効化せず warn として全件を継続検出し、画面ごとに順次解消していく (方針 B)。
  // 重大なフック順序ルール react-hooks/rules-of-hooks は error のまま据え置く
  // (React Compiler 診断ではなく、実バグを捕まえる従来ルールのため)。
  // ここに挙げるのは「現在 error で解決済み設定に実在する」react-hooks ルールのみ
  // (存在しないルール名を書くと ESLint が致命的エラーになるため)。現在 warn/off のものは触らない。
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/gating": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/config": "warn",
    },
  },
]

export default eslintConfig
