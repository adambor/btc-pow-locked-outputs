const bitcoin = require('bitcoinjs-lib');
global.network = bitcoin.networks.testnet;
if(process.argv[3]!=null) {
    switch (process.argv[3]) {
        case "mainnet":
            global.network = bitcoin.networks.bitcoin;
            break;
        case "testnet":
            global.network = bitcoin.networks.testnet;
            break;
        default:
            console.error("Unknown network argument, possible values: mainnet, testnet");
            console.log("Usage: node gen-address.js <work> <network: mainnet, testnet>");
            return;
    }
}

const powScript = require("./pow-script");
const work = parseInt(process.argv[2]);
if(isNaN(work)) {
    console.error("Invalid work provided, must be a number");
    console.log("Usage: node gen-address.js <work> <network: mainnet, testnet>");
    return;
}
console.log("Generating a locking script address for work: "+work);
console.log(powScript.getAddress(work));