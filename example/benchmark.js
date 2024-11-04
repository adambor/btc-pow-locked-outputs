const powScript = require("./pow-script");
const bitcoin = require("bitcoinjs-lib");
const crypto = require("crypto");

function runSingleRandom(work) {
    const address = powScript.getAddress(work);
    const witnessUtxo = {
        script: bitcoin.address.toOutputScript(address),
        value: 100000+Math.floor(Math.random() * 100000000),
        txId: crypto.randomBytes(32).toString("hex"),
        vout: Math.floor(Math.random() * 16)
    };
    const intermediateWitnessUtxo = {
        script: Buffer.concat([Buffer.from([0x00, 0x14]), crypto.randomBytes(20)]),
        value: 100000+Math.floor(Math.random() * 100000000),
        txId: crypto.randomBytes(32).toString("hex"),
        vout: Math.floor(Math.random() * 16)
    };
    const result = powScript.grindTransaction(
        work,
        witnessUtxo,
        intermediateWitnessUtxo,
        Math.floor(Math.random() * 50),
        bitcoin.payments.p2wpkh({hash: crypto.randomBytes(20)}).address
    );
    return result.totalWork;
}

const runs = 500;
const singleWork = 160000;

const startTime = Date.now();
let totalWork = 0;

for(let i=0;i<runs;i++) {
    const work = runSingleRandom(singleWork);
    totalWork += work;
    console.log("Work ("+i+"): ", work);
    console.log("Total work: ", totalWork);
    console.log("Average work: ", totalWork/(i+1));
    console.log("Hashrate: ", (totalWork/(Date.now()-startTime))*1000);
}

console.log("Total work: ", totalWork);
console.log("Average work: ", totalWork/runs);
