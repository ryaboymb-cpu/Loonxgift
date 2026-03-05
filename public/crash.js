async function playCrash(){

const res = await fetch("/api/crash")

const data = await res.json()

document.getElementById("multiplier").innerText = data.multiplier + "x"

}

setInterval(playCrash,3000)
