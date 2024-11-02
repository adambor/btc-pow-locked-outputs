const BN = require("bn.js");
const secp256k1 = require('secp256k1');
const crypto = require("crypto");
const bitcoin = require("bitcoinjs-lib");
const {Transaction} = require("bitcoinjs-lib");
const {sqrt} = require("bn-sqrt");
const ecc = require("tiny-secp256k1");
const fs = require("fs");

// const ECPair = new ECPairFactory.ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

const mod = new BN("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16);

function invertMod(a) {
    if(a==null) return null;
    let t = new BN(0);
    let r = mod;
    let newT = new BN(1);
    let newR = a;

    while(!newR.eq(new BN(0))) {
        const quotient = r.div(newR);
        const _newT = t.sub(quotient.mul(newT));
        t = newT;
        newT = _newT;
        const _newR = r.sub(quotient.mul(newR));
        r = newR;
        newR = _newR;
    }

    if(r.gt(new BN(1))) {
        return null;
    }
    if(t.lt(new BN(0))) {
        return t.add(mod);
    }
    return t;
}

function mul(a, b) {
    if(a==null || b==null) return null;
    return a.mul(b).mod(mod);
}

const k = invertMod(new BN(2));
const K = secp256k1.publicKeyCreate(k.toBuffer("be"), true);
const r = new BN(Buffer.from(K).slice(1));

function getPrivateKeyBNForOffset(offset) {
    return mul(invertMod(r), mod.sub(offset));
}

function getPrivateKeyForOffset(offset) {
    return getPrivateKeyBNForOffset(offset).toBuffer("be");
}

function checkHash(transaction, intervals, witnessUtxo, sighashes) {
    const foundIntervals = [];
    for(let sighash of sighashes) {
        const hash = transaction.hashForWitnessV0(0, witnessUtxo.script, witnessUtxo.value, sighash);
        const hashNum = new BN(hash, 16);
        const found = intervals.find(({i1d, i1u, i2d, i2u}) =>
            (hashNum.gte(i1d) && hashNum.lt(i1u)) ||
            (hashNum.gte(i2d) && hashNum.lt(i2u))
        );
        if(found==null) return null;
        if(foundIntervals.includes(found)) return null;
        foundIntervals.push(found);
    }

    return foundIntervals.map(interval => interval.index);
}

function getOutputScript(intervalKeys) {
    return Buffer.concat(intervalKeys.map(({d1, d2}) => {
        const script1 = "OP_SIZE 3c OP_LESSTHAN OP_VERIFY "+
            Buffer.from(secp256k1.publicKeyCreate(d1.toBuffer("be", 32), true)).toString("hex")+
            " OP_CHECKSIGVERIFY";
        const script2 = "OP_SIZE 3c OP_LESSTHAN OP_VERIFY "+
            Buffer.from(secp256k1.publicKeyCreate(d2.toBuffer("be", 32), true)).toString("hex")+
            " OP_CHECKSIGVERIFY";
        // console.log(script1);
        // console.log(script2);
        return Buffer.concat([bitcoin.script.fromASM(script1), bitcoin.script.fromASM(script2)]);
    }));
}

/**
 *
 * @param intervalKeys Array of {d1, d2} private keys creating an interval
 * @param witnessUtxo
 * @param intermediateWitnessUtxo
 * @param feeRateIntermediate
 * @param feeRate
 * @param recipient
 */
function grindTransactionFull(intervalKeys, witnessUtxo, intermediateWitnessUtxo, feeRateIntermediate, feeRate, recipient) {
    const offset = mod.div(new BN(2)).add(new BN(1));
    let intervals = intervalKeys.map(({d1, d2}, index) => {
        const x1 = mod.sub(mul(d1, r));
        const x2 = mod.sub(mul(d2, r));

        if(!x1.lte(x2)) throw new Error("x1 must be smaller than x2");
        const i1d = x2;
        const i1u = x1.add(new BN(2).pow(new BN(246)));
        const i2d = i1d.add(offset);
        const i2u = i1u.add(offset);
        return {
            index,
            i1d,
            i1u,
            i2d,
            i2u
        };
    });

    witnessUtxo.script = getOutputScript(intervalKeys);

    const tx = new Transaction();
    tx.addInput(Buffer.from(witnessUtxo.txId, "hex").reverse(), witnessUtxo.vout);

    let work = 0;

    let locktime = 500000000;
    let nSequence = 0;
    let validInterval = null;
    while(locktime<1700000000 && validInterval==null) {
        tx.locktime = locktime;
        while(nSequence<0xEFFFFFFF && validInterval==null) {
            tx.ins[0].sequence = nSequence;
            validInterval = checkHash(tx, intervals, witnessUtxo, [0x82]);
            work++;
            nSequence++;
        }
        locktime++;
    }
    intervals = intervals.filter(interval => !validInterval.includes(interval.index));
    const [sighashNoneA] = validInterval;

    console.log("Interval 0x82: ", validInterval);

    validInterval = null;
    const immediateLeavesValue = intermediateWitnessUtxo.value-(110*feeRateIntermediate);
    const intermediateTxKey = crypto.randomBytes(32);
    const intermediatePublicKey = Buffer.from(secp256k1.publicKeyCreate(intermediateTxKey, true));
    const intermediatePayment = bitcoin.payments.p2wpkh({pubkey: intermediatePublicKey});
    const in2Tx = new Transaction();
    in2Tx.addInput(Buffer.from(intermediateWitnessUtxo.txId, "hex").reverse(), intermediateWitnessUtxo.vout);
    in2Tx.addOutput(intermediatePayment.output, immediateLeavesValue);
    tx.addInput(in2Tx.getHash(), 0);

    locktime = 500000000;
    nSequence = 0;
    validInterval = null;
    while(locktime<1700000000 && validInterval==null) {
        in2Tx.locktime = locktime;
        while(nSequence<0xEFFFFFFF && validInterval==null) {
            in2Tx.ins[0].sequence = nSequence;
            tx.ins[1].hash = in2Tx.getHash();
            validInterval = checkHash(tx, intervals, witnessUtxo, [0x02]);
            work+=2;
            nSequence++;
        }
        locktime++;
    }
    intervals = intervals.filter(interval => !validInterval.includes(interval.index));
    const [sighashNone] = validInterval;

    console.log("Interval 0x02: ", validInterval);

    const payoutValue = immediateLeavesValue + witnessUtxo.value - (500*feeRate);
    const seed = crypto.randomBytes(32);
    validInterval = null;
    tx.addOutput(Buffer.alloc(22, 0), payoutValue);
    let counter = 0;
    let output0Key;
    let output0Pubkey;
    let output0Payment;
    while(validInterval==null) {
        output0Key = crypto.createHash("sha256").update(seed).update(new BN(counter).toBuffer()).digest();
        output0Pubkey = Buffer.from(secp256k1.publicKeyCreate(output0Key, true));
        output0Payment = bitcoin.payments.p2wpkh({pubkey: output0Pubkey});
        tx.outs[0].script = output0Payment.output;
        validInterval = checkHash(tx, intervals, witnessUtxo, [0x83, 0x03]);
        counter++;
        work++;
    }
    intervals = intervals.filter(interval => !validInterval.includes(interval.index));
    const [sighashSingleA, sighashSingle] = validInterval;

    console.log("Interval 0x83 & 0x03: ", validInterval);

    const OP_RET_BUFFER = Buffer.from([0x6a]);
    validInterval = null;
    tx.addOutput(OP_RET_BUFFER, 0);
    counter = 0;
    while(validInterval==null) {
        const dataBuffer = new BN(counter).toBuffer("le");
        tx.outs[1].script = Buffer.concat([OP_RET_BUFFER, Buffer.from([dataBuffer.length]), dataBuffer]);
        validInterval = checkHash(tx, intervals, witnessUtxo, [0x81, 0x01]);
        counter++;
        work++;
    }
    intervals = intervals.filter(interval => !validInterval.includes(interval.index));
    const [sighashAllA, sighashAll] = validInterval;

    console.log("Interval 0x81 & 0x01: ", validInterval);

    const signIntervals = [];
    signIntervals[sighashAll] = 0x01;
    signIntervals[sighashNone] = 0x02;
    signIntervals[sighashSingle] = 0x03;
    signIntervals[sighashAllA] = 0x81;
    signIntervals[sighashNoneA] = 0x82;
    signIntervals[sighashSingleA] = 0x83;

    const witnessStack = [];
    for(let interval=0;interval<signIntervals.length;interval++) {
        const keys = intervalKeys[interval];
        const sighash = signIntervals[interval];
        const hash = tx.hashForWitnessV0(0, witnessUtxo.script, witnessUtxo.value, sighash);
        const sig1 = secp256k1.ecdsaSign(hash, keys.d1.toBuffer("be"), {
            noncefn: () => new Uint8Array(k.toBuffer("be"))
        }).signature;
        const sig2 = secp256k1.ecdsaSign(hash, keys.d2.toBuffer("be"), {
            noncefn: () => new Uint8Array(k.toBuffer("be"))
        }).signature;
        const bufferSighash = Buffer.from([sighash]);
        const derEncodedS1 = Buffer.concat([secp256k1.signatureExport(sig1, Buffer), bufferSighash]);
        const derEncodedS2 = Buffer.concat([secp256k1.signatureExport(sig2, Buffer), bufferSighash]);
        // console.log("Sig1: "+Buffer.from(sig1).slice(32).toString("hex"));
        // console.log("Sig2: "+Buffer.from(sig2).slice(32).toString("hex"));
        // console.log("Sig1DER: "+derEncodedS1.toString("hex"));
        // console.log("Sig2DER: "+derEncodedS2.toString("hex"));

        witnessStack.push(derEncodedS1);
        witnessStack.push(derEncodedS2);
    }

    witnessStack.push(Buffer.from([0x01]));
    witnessStack.reverse();
    witnessStack.push(witnessUtxo.script);

    tx.ins[0].witness = witnessStack;
    tx.ins[1].witness = [
        Buffer.concat([secp256k1.signatureExport(secp256k1.ecdsaSign(
            tx.hashForWitnessV0(1, bitcoin.payments.p2pkh({hash: in2Tx.outs[0].script.slice(2)}).output, in2Tx.outs[0].value, 0x01), intermediateTxKey
        ).signature, Buffer), Buffer.from([0x01])]),
        intermediatePublicKey
    ];

    const intermediatePsbt = new bitcoin.Psbt();
    intermediatePsbt.addInput(in2Tx.ins[0]);
    intermediatePsbt.updateInput(0, {
        witnessUtxo: intermediateWitnessUtxo
    });
    intermediatePsbt.addOutput(in2Tx.outs[0]);
    intermediatePsbt.setLocktime(in2Tx.locktime);
    intermediatePsbt.setVersion(in2Tx.version);

    const finalTransaction = new bitcoin.Transaction();
    finalTransaction.addInput(tx.getHash(), 0);
    finalTransaction.addOutput(bitcoin.address.toOutputScript(recipient), tx.outs[0].value-(110*feeRate));
    finalTransaction.ins[0].witness = [
        Buffer.concat([secp256k1.signatureExport(secp256k1.ecdsaSign(
            finalTransaction.hashForWitnessV0(0, bitcoin.payments.p2pkh({hash: output0Payment.hash}).output, tx.outs[0].value, 0x01), output0Key
        ).signature, Buffer), Buffer.from([0x01])]),
        output0Pubkey
    ];

    // console.log("Expected input: ", in2Tx.ins[0].hash);
    // console.log("Expected input: ", in2Tx.ins[0].sequence);
    // console.log("Expected input: ", in2Tx.ins[0].index);
    // console.log("Expected output: ", bitcoin.address.fromOutputScript(in2Tx.outs[0].script));
    // console.log("Expected output: ", in2Tx.outs[0].value);
    //
    // console.log("Intermediate PSBT expected id: ", in2Tx.getId());

    return {
        work,
        tx,
        intermediatePsbt,
        finalTx: finalTransaction,
        output0Key
    };

}

function grindTransaction(d1, d2, sighashType, locktime) {
    const x1 = mod.sub(mul(d1, r));
    const x2 = mod.sub(mul(d2, r));

    if(!x1.lte(x2)) throw new Error("x1 must be smaller than x2");
    const i1d = x2;
    const i1u = x1.add(new BN(2).pow(new BN(246)));
    const offset = mod.div(new BN(2)).add(new BN(1));
    const i2d = i1d.add(offset);
    const i2u = i1u.add(offset);

    const psbt = new bitcoin.Psbt();
    psbt.setLocktime(locktime);
    psbt.addInput({
        hash: "8e5b192f9dfd9de45f074a453fe8220af5100a4e198cb61f3eb0e81a0fd1941e",
        index: 0,
        sequence: 0xFFFFFFFF,
        nonWitnessUtxo: Buffer.from("020000000001014c5a4401050427412ea24298aa424a8d2892c9ad870aa711dca3c489fb70370b0000000000fdffffff02b711a34700000000160014dd03d4e41776fdf1a6d4a25b5a8b3b4cc17b48cd00e1f50500000000160014a704c89e6da9012ac45e705f961499a8bc61b43c0247304402201dae7c77ec46d9c53fbbd57b6b21ef645b47d149b7d516710cd1abae1acacd9e02207d4237909d645f73011e70394bc45cb7e1f5e794fab6e440c855ea2865988af001210254a4f44a7b55df50df368caa565827abac196312a0507fd758e62abcced40d2bd73b0d00", "hex"),
        sighashType
    });

    let counter = 0;
    let _hash = null;
    while(counter<0xFFFFFFFF) {
        psbt.setInputSequence(0, counter);
        try {
            psbt.signInput(0, {
                publicKey: Buffer.from("036b2bc9ca436526e058b2b362bccc10072dcf4dd7253fe499d5d65e2a2ce23bc7", "hex"),
                sign: (hash, lowR) => {
                    _hash = hash;
                    const hashNum = new BN(hash, 16);
                    if(
                        (hashNum.gte(i1d) && hashNum.lt(i1u)) ||
                        (hashNum.gte(i2d) && hashNum.lt(i2u))
                    ) return Buffer.alloc(64, 0);
                    throw new Error("Invalid hash");
                }
            }, [0x01, 0x02, 0x03, 0x81, 0x82, 0x83]);
            // const sig1 = secp256k1.ecdsaSign(_hash, d1.toBuffer("be"), {
            //     noncefn: () => new Uint8Array(k.toBuffer("be"))
            // });
            // const sig2 = secp256k1.ecdsaSign(_hash, d2.toBuffer("be"), {
            //     noncefn: () => new Uint8Array(k.toBuffer("be"))
            // });
            // console.log("Sig1: "+Buffer.from(sig1.signature).slice(32).toString("hex"));
            // console.log("Sig2: "+Buffer.from(sig2.signature).slice(32).toString("hex"));
            return counter;
        } catch (e) {
            counter++;
        }
    }
}

function getOffsets(x1, work) {
    const diff = new BN(2).pow(new BN(246)).sub(
        mod.div(work.mul(new BN(2)))
    );
    if(diff.isNeg()) throw new Error("Work less than minimal");
    console.log("Diff: ", diff.toString());
    const x2 = x1.add(diff);
    return {
        d1: getPrivateKeyBNForOffset(x1),
        d2: getPrivateKeyBNForOffset(x2)
    };
}

function getOffsetsFullGrind(x1, work, count) {
    const diff = new BN(2).pow(new BN(246)).sub(
        new BN(105).mul(mod).div(
            new BN(6).mul(sqrt(new BN(289).add(new BN(2100).mul(work)))).sub(new BN(102))
        )
    );
    if(diff.isNeg()) throw new Error("Work less than minimal");
    const x2 = x1.add(diff);
    // console.log("Diff: ", diff.toString(16).padStart(64, "0"));
    // console.log("(x"+count+"a, x"+count+"b) = (0x"+x1.toString(16).padStart(64, "0")+", 0x"+x2.toString(16).padStart(64, "0")+")");
    const d1 = getPrivateKeyBNForOffset(x1);
    const d2 = getPrivateKeyBNForOffset(x2);
    // console.log("(d"+count+"a, d"+count+"b) = (0x"+d1.toString(16).padStart(64, "0")+", 0x"+d2.toString(16).padStart(64, "0")+")");
    // console.log("(P"+count+"a, P"+count+"b) = ("+
    //     Buffer.from(secp256k1.publicKeyCreate(d1.toBuffer("be", 32), true)).toString("hex")
    //     +", "+
    //     Buffer.from(secp256k1.publicKeyCreate(d2.toBuffer("be", 32), true)).toString("hex")
    //     +")");
    // const script1 = "OP_SIZE 3c OP_LESSTHAN OP_VERIFY "+
    //     Buffer.from(secp256k1.publicKeyCreate(d1.toBuffer("be", 32), true)).toString("hex")+
    //     " OP_CHECKSIGVERIFY"
    // console.log(script1);
    // console.log(bitcoin.script.fromASM(script1).toString("hex"));
    // const script2 = "OP_SIZE 3c OP_LESSTHAN OP_VERIFY "+
    //     Buffer.from(secp256k1.publicKeyCreate(d2.toBuffer("be", 32), true)).toString("hex")+
    //     " OP_CHECKSIGVERIFY";
    // console.log(script2);
    // console.log(bitcoin.script.fromASM(script2).toString("hex"));
    return {
        d1,
        d2,
        script: getOutputScript([{d1, d2}])
    };
}

const singleWork = Math.pow(2, 18);

const keyset = [
    getOffsetsFullGrind(new BN(1), new BN(singleWork), 1),
    getOffsetsFullGrind(new BN(2).pow(new BN(248)).muln(1).add(new BN(1)), new BN(singleWork), 2),
    getOffsetsFullGrind(new BN(2).pow(new BN(248)).muln(2).add(new BN(1)), new BN(singleWork), 3),
    getOffsetsFullGrind(new BN(2).pow(new BN(248)).muln(3).add(new BN(1)), new BN(singleWork), 4),
    getOffsetsFullGrind(new BN(2).pow(new BN(248)).muln(4).add(new BN(1)), new BN(singleWork), 5),
    getOffsetsFullGrind(new BN(2).pow(new BN(248)).muln(5).add(new BN(1)), new BN(singleWork), 6)
];

const fullScript = Buffer.concat(keyset.map(key => key.script));
console.log(bitcoin.payments.p2wsh({
    redeem: {output: fullScript}
}).address);

// const iterations = 500;
// let totalWork = 0;
// for(let i=0;i<iterations;i++) {
//     const {work, tx} = grindTransactionFull(keyset, {
//         script: Buffer.from("00209a754d5e8cb48f86e0872b16ef1bbf3ea3c3b2e9d9e366b485b19d69f559d0fd", "hex"),
//         value: 2000,
//         txId: crypto.randomBytes(32).toString("hex"),
//         vout: 0
//     }, {
//         script: Buffer.from("00140c5228c8d9a5c9d55ab1a7b022d68714f5ea1854", "hex"),
//         value: 7235,
//         txId: crypto.randomBytes(32).toString("hex"),
//         vout: 1
//     }, 1, 1);
//     totalWork += work;
//     console.log("Work ("+i+"): ", work);
//     console.log("Total work: ", totalWork);
//     console.log("Average work: ", totalWork/(i+1));
// }
//
// console.log("Total work: ", totalWork);
// console.log("Average work: ", totalWork/iterations);

const witnessUtxo = {
    script: Buffer.from("00205e213308d94998c7c8192f4d4d82b44e275fb3435af18e5f25f222fa7824f3b8", "hex"),
    value: 1000,
    txId: "026e22cf7a43be4e6b952be681ce06774b92e11a99815537298f6214c026a383",
    vout: 0
};
const intermediateWitnessUtxo = {
    script: Buffer.from("00140ec6a7ea9ebb5abf708f170f3b81ec377d63edbf", "hex"),
    value: 3147,
    txId: "026e22cf7a43be4e6b952be681ce06774b92e11a99815537298f6214c026a383",
    vout: 1
};
const {
    work, tx, intermediatePsbt, finalTx, output0Key
} = grindTransactionFull(keyset, witnessUtxo, intermediateWitnessUtxo, 3, 3, "bc1qca8ladhsmutjsx63gcghl2k5fw8f57j0yfqgjk");
console.log("Total work: ", work);
console.log("TX size: ", tx.virtualSize());
console.log("Output 0 key: ", output0Key.toString("hex"));
fs.writeFileSync("tx.txt", tx.toHex());
fs.writeFileSync("finalTx.txt", finalTx.toHex());
fs.writeFileSync("psbt.txt", intermediatePsbt.toBase64());

// const sighashTypes = [0x01, 0x02, 0x03, 0x81, 0x82, 0x83];
// let expectedSum = 0;
// let actualSum = 0;
// for(let e=0;e<100;e++) {
//     for(let i=0;i<5;i++) {
//         const expectedWork = 256+(i*1000);
//         const {d1, d2} = getOffsets(new BN(1), new BN(expectedWork));
//         for(let sighashType of sighashTypes) {
//             expectedSum += expectedWork;
//             const realWork = grindTransaction(d1, d2, sighashType, Math.floor(Math.random()*0xFFFFFF));
//             actualSum += realWork;
//             // console.log("Found sequence: ", realWork);
//         }
//     }
//     console.log("Expected work: ", expectedSum);
//     console.log("Actual work: ", actualSum);
// }


// const m = Buffer.concat([Buffer.of(128), crypto.randomBytes(31)]);
// m[1] = m[1] % 128;
//
// const generatedSignature = secp256k1.ecdsaSign(m, getPrivateKeyForOffset(new BN(1)), {
//     noncefn: () => new Uint8Array(k.toBuffer("be"))
// });
//
// console.log(r.toString("hex"));
// console.log(k.toString(16));
//
// console.log("Generated signature: ", Buffer.from(generatedSignature.signature).slice(32).toString("hex"));
