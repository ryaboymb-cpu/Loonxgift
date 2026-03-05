const tg = window.Telegram.WebApp

tg.expand()

const user = tg.initDataUnsafe.user

async function login(){

const res = await fetch("/api/login",{

method:"POST",
headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({

telegramId:user.id,
username:user.username

})

})

const data = await res.json()

console.log("user",data)

}

login()
