import type { Locale } from "./landing-messages"

// 導入ご相談 (/contact) の多言語文言。TOP の言語切替（6言語・パス方式）から
// ?lang= で引き継ぎ、この辞書で出し分ける。既定は日本語。
export const CONTACT_LOCALES: Locale[] = ["ja", "en", "es", "fr", "zh", "it"]

export function resolveContactLocale(v: string | null | undefined): Locale {
  return (CONTACT_LOCALES as string[]).includes(v ?? "") ? (v as Locale) : "ja"
}

// 各言語のトップ（戻り先）。TOP と同じパス方式。
export const HOME_PATH: Record<Locale, string> = {
  ja: "/",
  en: "/en",
  es: "/es",
  fr: "/fr",
  zh: "/zh",
  it: "/it",
}

export interface ContactStrings {
  back: string
  eyebrow: string
  title: string
  lead: string
  company: string
  name: string
  email: string
  message: string
  companyPh: string
  namePh: string
  messagePh: string
  submit: string
  doneTitle: string
  doneBody: string
  errorSend: string
  errorNetwork: string
  privacyPre: string
  privacyLink: string
  privacyPost: string
}

export const contactMessages: Record<Locale, ContactStrings> = {
  ja: {
    back: "トップへ戻る",
    eyebrow: "Contact",
    title: "BondEx 導入のご相談",
    lead: "訪日旅行代理店・ランドオペレーターさま向けの荷物配送手配サービスです。料金・運用・導入手順など、お気軽にお問い合わせください。通常 1 営業日以内にご返信します。",
    company: "貴社名",
    name: "お名前",
    email: "メールアドレス",
    message: "ご相談内容",
    companyPh: "例: ○○トラベル株式会社",
    namePh: "例: 山田 太郎",
    messagePh: "ご質問・ご相談内容、想定される月間件数などをご記入ください。",
    submit: "送信する",
    doneTitle: "送信しました",
    doneBody: "お問い合わせありがとうございます。担当者より、通常 1 営業日以内にご入力のメールアドレス宛にご連絡いたします。",
    errorSend: "送信に失敗しました。時間をおいて再度お試しください。",
    errorNetwork: "送信に失敗しました。ネットワークをご確認ください。",
    privacyPre: "送信により ",
    privacyLink: "プライバシーポリシー",
    privacyPost: " に同意いただいたものとします。",
  },
  en: {
    back: "Back to top",
    eyebrow: "Contact",
    title: "Talk to BondEx",
    lead: "A luggage-forwarding coordination service for inbound travel agencies and land operators. Ask us anything — pricing, operations, or how to get started. We usually reply within one business day.",
    company: "Company",
    name: "Name",
    email: "Email",
    message: "How can we help?",
    companyPh: "e.g. ABC Travel Co., Ltd.",
    namePh: "e.g. Taro Yamada",
    messagePh: "Tell us your question and, if possible, your expected monthly volume.",
    submit: "Send",
    doneTitle: "Message sent",
    doneBody: "Thank you for reaching out. Our team will get back to you at the email address you provided, usually within one business day.",
    errorSend: "Couldn’t send. Please try again in a moment.",
    errorNetwork: "Couldn’t send. Please check your connection.",
    privacyPre: "By sending, you agree to our ",
    privacyLink: "Privacy Policy",
    privacyPost: ".",
  },
  es: {
    back: "Volver al inicio",
    eyebrow: "Contacto",
    title: "Habla con BondEx",
    lead: "Un servicio de coordinación de envío de equipaje para agencias de viajes receptivas y operadores locales. Pregúntanos lo que quieras: tarifas, operativa o cómo empezar. Normalmente respondemos en un día hábil.",
    company: "Empresa",
    name: "Nombre",
    email: "Correo electrónico",
    message: "¿En qué podemos ayudarte?",
    companyPh: "p. ej. ABC Travel, S.L.",
    namePh: "p. ej. Taro Yamada",
    messagePh: "Cuéntanos tu consulta y, si es posible, el volumen mensual previsto.",
    submit: "Enviar",
    doneTitle: "Mensaje enviado",
    doneBody: "Gracias por escribirnos. Nuestro equipo te responderá al correo que indicaste, normalmente en un día hábil.",
    errorSend: "No se pudo enviar. Inténtalo de nuevo en un momento.",
    errorNetwork: "No se pudo enviar. Comprueba tu conexión.",
    privacyPre: "Al enviar, aceptas nuestra ",
    privacyLink: "Política de Privacidad",
    privacyPost: ".",
  },
  fr: {
    back: "Retour à l’accueil",
    eyebrow: "Contact",
    title: "Contactez BondEx",
    lead: "Un service de coordination d’acheminement des bagages pour les agences de voyage réceptives et les opérateurs locaux. Posez-nous vos questions : tarifs, fonctionnement ou premiers pas. Nous répondons généralement sous un jour ouvré.",
    company: "Société",
    name: "Nom",
    email: "E-mail",
    message: "Comment pouvons-nous aider ?",
    companyPh: "ex. ABC Travel SARL",
    namePh: "ex. Taro Yamada",
    messagePh: "Indiquez votre question et, si possible, le volume mensuel envisagé.",
    submit: "Envoyer",
    doneTitle: "Message envoyé",
    doneBody: "Merci de nous avoir contactés. Notre équipe vous répondra à l’adresse e-mail indiquée, généralement sous un jour ouvré.",
    errorSend: "Échec de l’envoi. Réessayez dans un instant.",
    errorNetwork: "Échec de l’envoi. Vérifiez votre connexion.",
    privacyPre: "En envoyant, vous acceptez notre ",
    privacyLink: "Politique de confidentialité",
    privacyPost: ".",
  },
  zh: {
    back: "返回首页",
    eyebrow: "联系",
    title: "联系 BondEx",
    lead: "面向入境旅行社与地接社的行李转运协调服务。价格、运营、接入流程等，欢迎随时咨询。我们通常在一个工作日内回复。",
    company: "公司名称",
    name: "姓名",
    email: "电子邮箱",
    message: "咨询内容",
    companyPh: "例：ABC 旅行有限公司",
    namePh: "例：山田太郎",
    messagePh: "请填写您的问题，如方便请注明预计的每月件数。",
    submit: "发送",
    doneTitle: "已发送",
    doneBody: "感谢您的咨询。我们的团队会通过您填写的邮箱与您联系，通常在一个工作日内。",
    errorSend: "发送失败，请稍后重试。",
    errorNetwork: "发送失败，请检查网络连接。",
    privacyPre: "发送即表示您同意我们的",
    privacyLink: "隐私政策",
    privacyPost: "。",
  },
  it: {
    back: "Torna alla home",
    eyebrow: "Contatti",
    title: "Parla con BondEx",
    lead: "Un servizio di coordinamento per l’inoltro dei bagagli per agenzie di viaggio incoming e operatori locali. Chiedici pure di tariffe, operatività o come iniziare. Di norma rispondiamo entro un giorno lavorativo.",
    company: "Azienda",
    name: "Nome",
    email: "Email",
    message: "Come possiamo aiutarti?",
    companyPh: "es. ABC Travel S.r.l.",
    namePh: "es. Taro Yamada",
    messagePh: "Descrivi la tua richiesta e, se possibile, il volume mensile previsto.",
    submit: "Invia",
    doneTitle: "Messaggio inviato",
    doneBody: "Grazie per averci contattato. Il nostro team ti risponderà all’indirizzo email indicato, di norma entro un giorno lavorativo.",
    errorSend: "Invio non riuscito. Riprova tra poco.",
    errorNetwork: "Invio non riuscito. Controlla la connessione.",
    privacyPre: "Inviando, accetti la nostra ",
    privacyLink: "Informativa sulla privacy",
    privacyPost: ".",
  },
}
