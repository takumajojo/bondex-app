/** 試験用: 運営のセッションの cookie の値を出す（ローカルの画面の試験だけ。OPERATOR_SESSION_SECRET はローカルの .env.local の値） */
import { issueOperatorSession } from "@/lib/operator-session"
issueOperatorSession(process.argv[2] || undefined).then((t) => { console.log(t); process.exit(0) })
