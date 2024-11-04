const bitcoin = require('bitcoinjs-lib');
const fs = require('fs');
const {getWitnessUtxo} = require("./mempoolapi");

function logUsage(){
    console.log("Usage: node grind.js <work> <network: mainnet, testnet3, testnet4> <pow-locked UTXO in format txId:vout> <intermediate UTXO in format txId:vout> <fee rate sats/vB> <recipient address>");
}

global.network = bitcoin.networks.testnet;
const network = process.argv[3];
switch (network) {
    case "mainnet":
        global.network = bitcoin.networks.bitcoin;
        break;
    case "testnet3":
        global.network = bitcoin.networks.testnet;
        break;
    case "testnet4":
        global.network = bitcoin.networks.testnet;
        break;
    default:
        console.error("Unknown network argument, possible values: mainnet, testnet3, testnet4");
        logUsage();
        return;
}

const powScript = require("./pow-script");
const {grindTransaction} = require("./pow-script");

const work = parseInt(process.argv[2]);
if(isNaN(work)) {
    console.error("Invalid work provided, must be a number");
    logUsage();
    return;
}

const feeRate = parseInt(process.argv[6]);
if(isNaN(feeRate)) {
    console.error("Invalid fee rate provided, must be a number");
    logUsage();
    return;
}

async function getWitnessUtxoFromString(str) {
    if(str==null) {
        console.error("Invalid pow locked UTXO provided, must be a valid format txId:vout");
        logUsage();
        return;
    }
    const [txId, voutStr] = str.split(":");
    const vout = parseInt(voutStr);
    return await getWitnessUtxo(txId, vout, network);
}


async function main() {
    console.log("Fetching witness UTXO for pow-locked output...");
    const powOutputWitnessUtxo = await getWitnessUtxoFromString(process.argv[4]);
    console.log("Fetching witness UTXO for intermediate output...");
    const intermediateWitnessUtxo = await getWitnessUtxoFromString(process.argv[5]);
    console.log("Starting grinding with work: "+work+" feeRate: "+feeRate+" recipient: "+process.argv[7]);
    const result = grindTransaction(work, powOutputWitnessUtxo, intermediateWitnessUtxo, feeRate, process.argv[7], true);
    if(!fs.existsSync("transactions")) fs.mkdirSync("transactions");
    fs.writeFileSync("transactions/psbt.txt", result.intermediatePsbt.toBase64());
    fs.writeFileSync("transactions/claimTx.txt", result.claimTx.toHex());
    fs.writeFileSync("transactions/spendTx.txt", result.spendTx.toHex());
    console.log("Successfully mined a PoW output, files created (in transactions directory): psbt.txt, claimTx.txt, spendTx.txt");
    console.log("Total work: "+result.totalWork);
}

main();
