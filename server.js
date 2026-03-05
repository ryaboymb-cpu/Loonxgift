const express = require("express")
const cors = require("cors")

const crashEngine = require("./server/crashEngine")
const balance = require("./server/balance")

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static("public"))

app.get("/api/crash", (req,res)=>{

const game = crashEngine.generate()

res.json(game)

})

app.post("/api/bet",(req,res)=>{

const {user,amount} = req.body

const result = balance.bet(user,amount)

res.json(result)

})

app.get("/api/balance/:user",(req,res)=>{

const user = req.params.user

const bal = balance.get(user)

res.json({balance:bal})

})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{

console.log("server running "+PORT)

})
