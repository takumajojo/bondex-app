// stripe パッケージの偽物。実際の Stripe には一切送らない。
import { calls, db } from "./state"

export default class Stripe {
  customers = {
    retrieve: async () => {
      calls.customerRetrieve++
      return { invoice_settings: { default_payment_method: db.defaultPm } }
    },
  }
  paymentIntents = {
    create: async () => {
      calls.piCreate++
      return { id: `pi_fake_${calls.piCreate}`, status: "succeeded" }
    },
  }
}
