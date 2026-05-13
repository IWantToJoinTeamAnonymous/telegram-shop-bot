require("dotenv").config()

const { Telegraf, Markup } = require("telegraf")
const mongoose = require("mongoose")
const express = require("express")
const fs = require("fs")

const app = express()

app.get("/", (req, res) => {
  res.send("Bot đang hoạt động")
})

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running")
})

const bot = new Telegraf(process.env.BOT_TOKEN)

mongoose.connect(process.env.MONGO_URI)
.then(() => {
  console.log("MongoDB connected")
})
.catch((err) => {
  console.log(err)
})

const userSchema = new mongoose.Schema({
  telegramId: Number,
  username: String,

  balance: {
    type: Number,
    default: 0
  }
})

const orderSchema = new mongoose.Schema({
  orderId: String,
  telegramId: Number,
  username: String,
  product: String,
  price: Number,

  status: {
    type: String,
    default: "pending"
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
})

const User = mongoose.model("User", userSchema)
const Order = mongoose.model("Order", orderSchema)

const products = {

  chatgpt: {
    name: "ChatGPT Plus",
    price: 49000,
    stockFile: "./stock/chatgpt.txt"
  },

  claude: {
    name: "Claude Pro",
    price: 39000,
    stockFile: "./stock/claude.txt"
  },

  canva: {
    name: "Canva Pro",
    price: 29000,
    stockFile: "./stock/canva.txt"
  },

  proxy: {
    name: "Private Proxy",
    price: 15000,
    stockFile: "./stock/proxy.txt"
  }
}

function createOrderId() {
  return Math.floor(Math.random() * 999999).toString()
}

function getStock(productKey) {

  const file = products[productKey].stockFile

  if (!fs.existsSync(file)) {
    return []
  }

  const data = fs.readFileSync(file, "utf8")

  return data
    .split("\\n")
    .filter(x => x.trim() !== "")
}

function removeFirstStock(productKey) {

  const file = products[productKey].stockFile

  const stock = getStock(productKey)

  const first = stock.shift()

  fs.writeFileSync(file, stock.join("\\n"))

  return first
}

bot.start(async (ctx) => {

  const telegramId = ctx.from.id

  let user = await User.findOne({
    telegramId
  })

  if (!user) {

    user = await User.create({
      telegramId,
      username: ctx.from.username || "NoUsername"
    })
  }

  ctx.reply(
`🛒 Welcome ${ctx.from.first_name}

Bot bán acc premium tự động

Chọn chức năng:`,
    Markup.keyboard([
      ["🛍 Shop", "📦 Orders"],
      ["👤 Profile", "🆘 Support"]
    ]).resize()
  )
})

bot.hears("🛍 Shop", async (ctx) => {

  let text = `🛒 DANH SÁCH SẢN PHẨM

`

  for (const key in products) {

    const p = products[key]

    const stock = getStock(key).length

    text +=
`📦 ${p.name}
💰 ${p.price.toLocaleString()}đ
📊 Stock: ${stock}

`
  }

  ctx.reply(
    text,

    Markup.inlineKeyboard([
      [Markup.button.callback("Buy ChatGPT", "buy_chatgpt")],
      [Markup.button.callback("Buy Claude", "buy_claude")],
      [Markup.button.callback("Buy Canva", "buy_canva")],
      [Markup.button.callback("Buy Proxy", "buy_proxy")]
    ])
  )
})

bot.action(/buy_(.+)/, async (ctx) => {

  const productKey = ctx.match[1]

  const product = products[productKey]

  const stock = getStock(productKey)

  if (stock.length === 0) {
    return ctx.reply("❌ Hết hàng")
  }

  const orderId = createOrderId()

  await Order.create({
    orderId,
    telegramId: ctx.from.id,
    username: ctx.from.username || "NoUsername",
    product: productKey,
    price: product.price
  })

  const message =
`🧾 ORDER CREATED

📦 Product:
${product.name}

💰 Price:
${product.price.toLocaleString()}đ

🆔 Order ID:
${orderId}

💳 ZaloPay:
${process.env.ZALOPAY_NAME}

📱 Number:
${process.env.ZALOPAY_NUMBER}

📌 Nội dung CK:
BUY_${orderId}

Sau khi thanh toán hãy bấm nút bên dưới.`

  ctx.reply(
    message,

    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "✅ Tôi đã thanh toán",
          `paid_${orderId}`
        )
      ]
    ])
  )

  bot.telegram.sendMessage(
    process.env.ADMIN_ID,

`🛒 ORDER MỚI

👤 User:
@${ctx.from.username}

📦 Product:
${product.name}

💰 Price:
${product.price.toLocaleString()}đ

🆔 Order ID:
${orderId}`
  )
})

bot.action(/paid_(.+)/, async (ctx) => {

  const orderId = ctx.match[1]

  const order = await Order.findOne({
    orderId
  })

  if (!order) {
    return ctx.reply("❌ Không tìm thấy order")
  }

  ctx.reply("⏳ Đã gửi yêu cầu xác nhận")

  bot.telegram.sendMessage(
    process.env.ADMIN_ID,

`💸 USER ĐÃ THANH TOÁN

🆔 Order:
${orderId}

👤 User:
@${ctx.from.username}

/confirm ${orderId}`
  )
})

bot.command("confirm", async (ctx) => {

  if (
    ctx.from.id.toString()
    !== process.env.ADMIN_ID
  ) {
    return
  }

  const args = ctx.message.text.split(" ")

  const orderId = args[1]

  const order = await Order.findOne({
    orderId
  })

  if (!order) {
    return ctx.reply("❌ Không tìm thấy order")
  }

  if (order.status === "done") {
    return ctx.reply("⚠️ Order đã xử lý")
  }

  const stock = getStock(order.product)

  if (stock.length === 0) {
    return ctx.reply("❌ Hết stock")
  }

  const account = removeFirstStock(order.product)

  order.status = "done"

  await order.save()

  await bot.telegram.sendMessage(
    order.telegramId,

`✅ THANH TOÁN THÀNH CÔNG

📦 Product:

${account}

⚠️ Hãy đổi password nếu cần.`
  )

  ctx.reply(
    `✅ Đã giao sản phẩm cho order ${orderId}`
  )
})

bot.hears("📦 Orders", async (ctx) => {

  const orders = await Order.find({
    telegramId: ctx.from.id
  })

  if (orders.length === 0) {
    return ctx.reply("📭 Bạn chưa có order nào")
  }

  let text = `📦 DANH SÁCH ORDER

`

  orders.forEach((o) => {

    text +=
`🆔 ${o.orderId}
📦 ${o.product}
📌 ${o.status}

`
  })

  ctx.reply(text)
})

bot.hears("👤 Profile", async (ctx) => {

  const user = await User.findOne({
    telegramId: ctx.from.id
  })

  ctx.reply(
`👤 PROFILE

🆔 ID:
${ctx.from.id}

👤 Username:
@${ctx.from.username}

💰 Balance:
${user.balance}đ`
  )
})

bot.hears("🆘 Support", (ctx) => {
  ctx.reply("📩 Liên hệ admin: @yourusername")
})

bot.launch()

console.log("Bot started")