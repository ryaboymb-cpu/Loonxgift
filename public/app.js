const socket = io()

socket.on("online",(count)=>{

document.getElementById("onlineCount").innerText = count

})

setTimeout(()=>{

document.getElementById("loader").style.display="none"
document.getElementById("app").classList.remove("hidden")

},4000)


function openScreen(id){

document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"))

document.getElementById(id).classList.add("active")

}

function openCrash(){

openScreen("crash")

}

function openMines(){

openScreen("mines")

}


function startCrash(){

let multi=1

let rocket=document.getElementById("rocket")

rocket.style.transform="translateY(-300px)"

let interval=setInterval(()=>{

multi+=0.1

document.getElementById("multiplier").innerText = multi.toFixed(2)+"x"

if(Math.random()<0.03){

clearInterval(interval)

rocket.style.transform="translateY(0)"

}

},100)

}


const grid=document.getElementById("mineGrid")

for(let i=0;i<25;i++){

let cell=document.createElement("div")

cell.className="cell"

cell.onclick=()=>{

if(Math.random()<0.2){

cell.style.background="red"

}else{

cell.style.background="green"

}

}

grid.appendChild(cell)

}


const tg = window.Telegram.WebApp

tg.expand()

if(tg.initDataUnsafe.user){

document.getElementById("tgUser").innerText = tg.initDataUnsafe.user.username

}
