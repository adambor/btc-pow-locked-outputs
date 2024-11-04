const BN = require("bn.js");
const secp256k1field = require('../secp256k1-field');
const secp256k1 = require("secp256k1");
const {sqrt} = require("bn-sqrt");
const bitcoin = require("bitcoinjs-lib");
const crypto = require("crypto");
const {hashForWitnessV0} = require("./sighasher");

/**
 * Version of the pow-script caching the values for sighash to speed up the computation
 */

//Well known nonce k=1/2 producing a nonce point with short x coordinate
const k = secp256k1field.invert(new BN(2));
//Nonce point
const K = secp256k1.publicKeyCreate(k.toBuffer("be"), true);
//Extract r-value (x coordinate of the nonce point
const r = new BN(Buffer.from(K).slice(1));

const nHalf = secp256k1field.n.div(new BN(2)).add(new BN(1));

/**
 * Signs the first input of the transaction using the known nonce k, and provided private key d
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param d {BN} Private key to use for signing
 * @param sighash {number} Sighash to use for signing
 * @returns {Buffer} DER-encoded signature
 */
function signP2WSHInputWithKnownNonce(tx, witnessUtxo, d, sighash) {
    const hash = tx.hashForWitnessV0(0, witnessUtxo.script, witnessUtxo.value, sighash);
    const ecdsaSignature = secp256k1.ecdsaSign(hash, d.toBuffer("be"), {
        noncefn: () => new Uint8Array(k.toBuffer("be"))
    }).signature;
    const bufferSighash = Buffer.from([sighash]);
    return Buffer.concat([secp256k1.signatureExport(ecdsaSignature, Buffer), bufferSighash]);
}

/**
 * Signs the input of the transaction using the provided private key
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param vin {number} Input index to sign
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param privateKey {Buffer} Private key to use for signing
 * @param sighash {number} Sighash to use for signing
 * @returns {Buffer} DER-encoded signature
 */
function signP2WSHInput(tx, vin, witnessUtxo, privateKey, sighash) {
    const hash = tx.hashForWitnessV0(vin, witnessUtxo.script, witnessUtxo.value, sighash);
    const ecdsaSignature = secp256k1.ecdsaSign(hash, privateKey).signature;
    const bufferSighash = Buffer.from([sighash]);
    return Buffer.concat([secp256k1.signatureExport(ecdsaSignature, Buffer), bufferSighash]);
}

/**
 * Signs the input of the transaction using the provided private key
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param vin {number} Input index to sign
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param privateKey {Buffer} Private key to use for signing
 * @param sighash {number} Sighash to use for signing
 * @returns {Buffer} DER-encoded signature
 */
function signP2WPKHInput(tx, vin, witnessUtxo, privateKey, sighash) {
    const publicKey = secp256k1.publicKeyCreate(privateKey, true, Buffer);
    const hash = tx.hashForWitnessV0(vin, bitcoin.payments.p2pkh({
        pubkey: publicKey,
    }).output, witnessUtxo.value, sighash);
    const ecdsaSignature = secp256k1.ecdsaSign(hash, privateKey).signature;
    const bufferSighash = Buffer.from([sighash]);
    return Buffer.concat([secp256k1.signatureExport(ecdsaSignature, Buffer), bufferSighash]);
}

/**
 * Returns a bitcoin script for pushing the number onto the stack
 * @param a {number} Number to push onto the stack
 * @returns {Buffer} generated script opcodes to push the number onto the stack
 */
function pushNumber(a) {
    if(a===0) {
        return Buffer.from([0x00]);
    } else if(a<=16) {
        return Buffer.from([0x50+a]);
    } else {
        const aBN = new BN(a);
        const aBuffer = aBN.toBuffer("be");
        return Buffer.concat([
            Buffer.from([aBuffer.length]),
            aBuffer
        ]);
    }
}

/**
 * @param x {BN} x-value of the interval offset
 * @returns {BN} private key value d, d=-x/r
 */
function getPrivateKeyFromX(x) {
    return secp256k1field.negate(secp256k1field.div(x, r));
}

/**
 * @param d {BN} private key value d
 * @returns {BN} x-value of the interval offset, x=-d*r
 */
function getXFromPrivateKey(d) {
    return secp256k1field.negate(secp256k1field.mul(d, r));
}

/**
 * @param d {BN} Private key
 * @returns {Buffer} Compressed public key
 */
function getPublicKey(d) {
    return secp256k1.publicKeyCreate(d.toBuffer("be", 32), true);
}

/**
 * Returns the keyset, 6 pairs of private keys, creating the tx hash intervals for all sighashes
 * @param work {number} Amount of work required to spend the output
 * @returns {{d1: BN, d2: BN}[]} Generated private key pairs
 */
function getKeyset(work) {
    const deltaX = new BN(2).pow(new BN(246)).sub(
        new BN(105).mul(secp256k1field.n).div(
            new BN(6).mul(sqrt(new BN(289).add(new BN(2100).mul(new BN(work))))).sub(new BN(102))
        )
    );

    if(deltaX.isNeg()) throw new Error("Work less than minimal");

    const keyset = [];
    for(let i=0;i<6;i++) {
        const x1 = new BN(2).pow(new BN(248)).muln(i).add(new BN(1));
        const x2 = x1.add(deltaX);
        //Get the corresponding private keys
        const d1 = getPrivateKeyFromX(x1);
        const d2 = getPrivateKeyFromX(x2);
        keyset.push({d1, d2});
    }

    return keyset;
}

/**
 * @param keyset {{d1: BN, d2: BN}[]} Private key pairs
 * @returns {Buffer[]} Array of compressed public keys
 */
function toPublicKeys(keyset) {
    return keyset.map(({d1, d2}) => [getPublicKey(d1), getPublicKey(d2)]).flat();
}

/**
 * @param publicKeys {Buffer[]} Array of compressed public keys
 * @returns {Buffer} A redeem script for the output
 */
function toScript(publicKeys) {
    return Buffer.concat(publicKeys.map(publicKey => {
        return Buffer.concat([
            Buffer.from([
                bitcoin.script.OPS.OP_SIZE,
                0x01,
                0x3c,
                bitcoin.script.OPS.OP_LESSTHAN,
                bitcoin.script.OPS.OP_VERIFY,
                0x21,
            ]),
            publicKey,
            Buffer.from([
                bitcoin.script.OPS.OP_CHECKSIGVERIFY
            ])
        ]);
    }));
}

/**
 *
 * @param script {Buffer} A redeem script for the output
 * @returns {string} On-chain p2wsh address for the specific script
 */
function toAddress(script) {
    return bitcoin.payments.p2wsh({
        redeem: {output: script}
    }).address;
}

/**
 * @param work {number} Amount of work required to spend the output
 * @returns {string} On-chain p2wsh address
 */
function getAddress(work) {
    return toAddress(toScript(toPublicKeys(getKeyset(work))));
}

/**
 * @param keyset {{d1: BN, d2: BN}[]} Private key pairs
 * @returns {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]} Array of pairs of intervals
 */
function getIntervals(keyset) {
    return keyset.map(({d1, d2}, index) => {
        const x1 = getXFromPrivateKey(d1);
        const x2 = getXFromPrivateKey(d2);

        const I1 = {
            down: x2,
            up: x1.add(new BN(2).pow(new BN(246)))
        };
        const I2 = {
            down: I1.down.add(nHalf),
            up: I1.up.add(nHalf)
        }

        return {
            I1,
            I2,
            index
        }
    });
}

/**
 * Grinds the transaction with SIGHASH_NONE | ANYONECANPAY sighash
 * @param tx {bitcoin.Transaction} Transaction to grind
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param intervals {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]} Array of pairs of intervals
 * @param sighashes {number[]} Array of sighashes to check, all need to be satisfied for the function to return success
 * @returns {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[] | null} Array of valid intervals or null
 */
function checkHash(tx, intervals, witnessUtxo, sighashes, sighashCache) {
    const foundIntervals = [];
    for(let sighash of sighashes) {
        // const hash = tx.hashForWitnessV0(0, witnessUtxo.script, witnessUtxo.value, sighash);
        const hash = hashForWitnessV0(tx, 0, witnessUtxo.script, witnessUtxo.value, sighash, sighashCache==null ? null : sighashCache[sighash]);
        // const hash2 = hashForWitnessV0(tx, 0, witnessUtxo.script, witnessUtxo.value, sighash);
        // if(!hash.equals(hash2)) throw new Error("Sighashes don't match!");
        const hashBN = new BN(hash, 16);
        const found = intervals.find(({I1, I2}) =>
            (hashBN.gte(I1.down) && hashBN.lt(I1.up)) ||
            (hashBN.gte(I2.down) && hashBN.lt(I2.up))
        );
        if(found==null) return null;
        if(foundIntervals.includes(found)) return null;
        foundIntervals.push(found);
    }
    return foundIntervals;
}

/**
 * Grinds the transaction with SIGHASH_NONE | ANYONECANPAY sighash by grinding the locktime & nSequence of the claim transaction
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param intervals {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]} Array of pairs of intervals
 * @returns {{work: number, validIntervals: {I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]}} A work done
 *  to get the valid hash, and a valid interval used up for the hash
 */
function grindSighashNoneAnyonecanpay(tx, witnessUtxo, intervals) {
    let work = 0;
    let locktime = 500000000;
    let nSequence = 0;
    let validIntervals = null;
    while(locktime<1700000000 && validIntervals==null) {
        tx.locktime = locktime;
        while(nSequence<0xEFFFFFFF && validIntervals==null) {
            tx.ins[0].sequence = nSequence;
            validIntervals = checkHash(tx, intervals, witnessUtxo, [0x82]);
            work++;
            nSequence++;
        }
        locktime++;
    }
    return {
        work,
        validIntervals
    };
}

/**
 * Grinds the transaction with SIGHASH_NONE sighash by creating an intermediate transaction from intermediateWitnessUtxo
 *  and grinding its locktime & nSequence, then using the output of this intermediate transaction as 2nd input of the
 *  claim transaction
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param intermediateWitnessUtxo {{script: Buffer, value: number, txId: string, vout: number}} Utxo data about the output
 *  to be used for intermediate transaction
 * @param feeRate {number} fee rate to be used for the intermediate transaction
 * @param intervals {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]} Array of pairs of intervals
 * @returns {{
 *  work: number,
 *  validIntervals: {I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[],
 *  intermediatePsbt: bitcoin.Psbt,
 *  intermediateKey: Buffer,
 *  intermediateTxId: string
 * }} A work done to get the valid hash, a valid interval used up for the hash, intermediate tx PSBT & key for the output
 *  of the intermediate tx PSBT to be used as 2nd input in the claim transaction
 */
function grindSighashNone(tx, witnessUtxo, intermediateWitnessUtxo, feeRate, intervals) {
    //Create ephemeral key for the intermediate transaction
    const key = crypto.randomBytes(32);
    const publicKey = secp256k1.publicKeyCreate(key, true, Buffer);
    const payment = bitcoin.payments.p2wpkh({pubkey: publicKey});

    const leavesValue = intermediateWitnessUtxo.value-(110*feeRate);
    const intermediateTx = new bitcoin.Transaction();

    intermediateTx.addInput(Buffer.from(intermediateWitnessUtxo.txId, "hex").reverse(), intermediateWitnessUtxo.vout);
    intermediateTx.addOutput(payment.output, leavesValue);

    tx.addInput(intermediateTx.getHash(), 0);

    let work = 0;
    let locktime = 500000000;
    let nSequence = 0;
    let validIntervals = null;
    while(locktime<1700000000 && validIntervals==null) {
        intermediateTx.locktime = locktime;
        while(nSequence<0xEFFFFFFF && validIntervals==null) {
            intermediateTx.ins[0].sequence = nSequence;
            // const hash = intermediateTx.getHash();
            const hash = intermediateTx.getHash();
            // if(!hash.equals(hash2)) throw new Error("Tx hashes don't match!");
            tx.ins[1].hash = hash;
            validIntervals = checkHash(tx, intervals, witnessUtxo, [0x02]);
            work+=2;
            nSequence++;
        }
        locktime++;
    }

    const intermediatePsbt = new bitcoin.Psbt();
    intermediatePsbt.addInput(intermediateTx.ins[0]);
    intermediatePsbt.updateInput(0, {
        witnessUtxo: intermediateWitnessUtxo
    });
    intermediatePsbt.addOutput(intermediateTx.outs[0]);
    intermediatePsbt.setLocktime(intermediateTx.locktime);
    intermediatePsbt.setVersion(intermediateTx.version);

    return {
        work,
        validIntervals,
        intermediatePsbt,
        intermediateKey: key,
        intermediateTxId: intermediateTx.getId()
    };
}

/**
 * Grinds the transaction with SIGHASH_SINGLE & SIGHASH_SINGLE | ANYONECANPAY sighash together by adding a 1st output
 *  (claim output) and grinding the output script of that output through the use of P2WSH script and OP_DROPing the nonce
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param intervals {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]} Array of pairs of intervals
 * @param outputValue {number} Amount of sats to put into the first transaction output
 * @returns {{work: number, validIntervals: {I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[], claimKey: Buffer, claimScript: Buffer, counter: number}} A work done
 *  to get the valid hash, and a valid interval used up for the hash
 */
function grindSighashSingle(tx, witnessUtxo, intervals, outputValue) {
    const key = crypto.randomBytes(32);
    const publicKey = secp256k1.publicKeyCreate(key, true, Buffer);

    const baseScript = Buffer.concat([
        Buffer.from([
            bitcoin.script.OPS.OP_DROP,
            0x21
        ]),
        publicKey,
        Buffer.from([
            bitcoin.script.OPS.OP_CHECKSIGVERIFY,
            bitcoin.script.OPS.OP_1
        ])
    ]);

    tx.addOutput(Buffer.alloc(34, 0), outputValue);

    let work = 0;
    let counter = 0;
    let validIntervals = null;
    let p2wshPayment = null;
    const sighashCache = [];
    sighashCache[0x03] = {};
    sighashCache[0x83] = {};
    while(validIntervals==null) {
        p2wshPayment = bitcoin.payments.p2wsh({
            redeem: {output: Buffer.concat([pushNumber(counter), baseScript])}
        });
        tx.outs[0].script = p2wshPayment.output;
        validIntervals = checkHash(tx, intervals, witnessUtxo, [0x03, 0x83], sighashCache);
        delete sighashCache[0x03].hashOutputs;
        delete sighashCache[0x83].hashOutputs;
        work++;
        counter++;
    }

    return {
        work,
        validIntervals,
        claimKey: key,
        claimScript: p2wshPayment.redeem.output,
        counter: counter-1
    };
}


/**
 * Grinds the transaction with SIGHASH_ALL & SIGHASH_ALL | ANYONECANPAY sighash together, by adding a 2nd OP_RETURN output
 *  to the transaction, and grinding the data in OP_RETURN
 * @param tx {bitcoin.Transaction} Claim transaction to grind
 * @param witnessUtxo {{script: Buffer, value: number}} Utxo data about the PoW locked output
 * @param intervals {{I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[]} Array of pairs of intervals
 * @returns {{work: number, validIntervals: {I1: {down: BN, up: BN}, I2: {down: BN, up: BN}, index: number}[], counter: number}} A work done
 *  to get the valid hash, and a valid interval used up for the hash
 */
function grindSighashAll(tx, witnessUtxo, intervals) {
    const baseScript = Buffer.from([
        bitcoin.script.OPS.OP_RETURN
    ]);

    tx.addOutput(baseScript, 0);

    let work = 0;
    let counter = 0;
    let validIntervals = null;
    const sighashCache = [];
    sighashCache[0x01] = {};
    sighashCache[0x81] = {};
    while(validIntervals==null) {
        tx.outs[1].script = Buffer.concat([baseScript, pushNumber(counter)]);
        validIntervals = checkHash(tx, intervals, witnessUtxo, [0x01, 0x81], sighashCache);
        delete sighashCache[0x01].hashOutputs;
        delete sighashCache[0x81].hashOutputs;
        work++;
        counter++;
    }

    return {
        work,
        validIntervals,
        counter: counter-1
    };
}

/**
 * Grinds (mines) the specific transaction output, an input for intermediate transaction must also be provided,
 *  after successful grinding of the transaction it returns the intermediatePsbt which should be signed the wallet to
 *  create an intermediateTx, a claimTx which claims the funds from the PoW-locked output & lastly a spendTx which
 *  transfers the funds to the recipient's address
 *
 * @param work {number} Required PoW work for the output
 * @param witnessUtxo {{script: Buffer, value: number, txId: string, vout: number}} Utxo data about the PoW locked output
 * @param intermediateWitnessUtxo {{script: Buffer, value: number, txId: string, vout: number}} Utxo data about the output
 *  to be used for intermediate transaction
 * @param feeRate {number} Fee rate to use for the transactions
 * @param recipient {string} Final recipient of the reward
 * @returns {{intermediatePsbt: bitcoin.Psbt, claimTx: bitcoin.Transaction, spendTx: bitcoin.Transaction, totalWork: number}}
 */
function grindTransaction(work, witnessUtxo, intermediateWitnessUtxo, feeRate, recipient, verbose = false) {
    const keyset = getKeyset(work);
    const script = toScript(toPublicKeys(keyset));
    const p2wshOutput = bitcoin.payments.p2wsh({
        redeem: {output: script}
    });
    //Check that script matches
    if(!witnessUtxo.script.equals(p2wshOutput.output)) throw new Error("Witness UTXO output script mismatch");
    witnessUtxo.script = script;

    let intervals = getIntervals(keyset);

    //Construct transaction
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.from(witnessUtxo.txId, "hex").reverse(), witnessUtxo.vout);

    //Grind transaction
    if(verbose) console.log("\nGrinding SIGHASH_NONE | ANYONECANPAY...");
    const sighashNoneA = grindSighashNoneAnyonecanpay(tx, witnessUtxo, intervals);
    intervals = intervals.filter(value => !sighashNoneA.validIntervals.includes(value)); //Remove used up intervals
    if(verbose) console.log("Using locktime: "+tx.locktime+" input0nSequence: "+tx.ins[0].sequence);
    if(verbose) console.log("Work: "+sighashNoneA.work+" intervals found: ", sighashNoneA.validIntervals.map(interval => interval.index));

    if(verbose) console.log("\nGrinding SIGHASH_NONE...");
    const sighashNone = grindSighashNone(tx, witnessUtxo, intermediateWitnessUtxo, feeRate, intervals);
    intervals = intervals.filter(value => !sighashNone.validIntervals.includes(value)); //Remove used up intervals
    if(verbose) console.log("Using"+
        " intermediateTxLocktime: "+sighashNone.intermediatePsbt.locktime+
        " intermediateTxInput0nSequence: "+sighashNone.intermediatePsbt.txInputs[0].sequence+
        " intermediateKey: "+sighashNone.intermediateKey.toString("hex")+
        " intermediateOutput0Script: "+sighashNone.intermediatePsbt.txOutputs[0].script.toString("hex")+
        " intermediateOutput0Value: "+sighashNone.intermediatePsbt.txOutputs[0].value+
        " intermediateTxId: "+sighashNone.intermediateTxId
    );
    if(verbose) console.log("Work: "+sighashNone.work+" intervals found: ", sighashNone.validIntervals.map(interval => interval.index));

    if(verbose) console.log("\nGrinding SIGHASH_SINGLE and SIGHASH_SINGLE | ANYONECANPAY...");
    const sighashSingle = grindSighashSingle(tx, witnessUtxo, intervals, witnessUtxo.value+sighashNone.intermediatePsbt.txOutputs[0].value-(500*feeRate));
    intervals = intervals.filter(value => !sighashSingle.validIntervals.includes(value)); //Remove used up intervals
    if(verbose) console.log("Using"+
        " claimKey: "+sighashSingle.claimKey.toString("hex")+
        " counter: "+sighashSingle.counter+
        " output0RedeemScript: "+sighashSingle.claimScript.toString("hex")+
        " output0Script: "+tx.outs[0].script.toString("hex")+
        " output0Value: "+tx.outs[0].value
    );
    if(verbose) console.log("Work: "+sighashSingle.work+" intervals found: ", sighashSingle.validIntervals.map(interval => interval.index));

    if(verbose) console.log("\nGrinding SIGHASH_ALL and SIGHASH_ALL | ANYONECANPAY...");
    const sighashAll = grindSighashAll(tx, witnessUtxo, intervals);
    if(verbose) console.log("Using"+
        " counter: "+sighashAll.counter+
        " output1Script: "+tx.outs[1].script.toString("hex")+
        " output1Value: "+tx.outs[1].value
    );
    if(verbose) console.log("Work: "+sighashAll.work+" intervals found: ", sighashAll.validIntervals.map(interval => interval.index));

    //Get the indexes of the private key pairs to use for respective sighashes
    const [shNoneA] = sighashNoneA.validIntervals.map(interval => interval.index);
    const [shNone] = sighashNone.validIntervals.map(interval => interval.index);
    const [shSingle, shSingleA] = sighashSingle.validIntervals.map(interval => interval.index);
    const [shAll, shAllA] = sighashAll.validIntervals.map(interval => interval.index);

    //Order the sighashes, such that we know which sighash to use for each of the private key pairs
    const intervalSighashes = [];
    intervalSighashes[shAll] = 0x01;
    intervalSighashes[shNone] = 0x02;
    intervalSighashes[shSingle] = 0x03;
    intervalSighashes[shAllA] = 0x81;
    intervalSighashes[shNoneA] = 0x82;
    intervalSighashes[shSingleA] = 0x83;

    //Add signatures to the witness stack
    const in0WitnessStack = [];
    for(let i=0;i<6;i++) {
        in0WitnessStack.push(signP2WSHInputWithKnownNonce(tx, witnessUtxo, keyset[i].d1, intervalSighashes[i]));
        in0WitnessStack.push(signP2WSHInputWithKnownNonce(tx, witnessUtxo, keyset[i].d2, intervalSighashes[i]));
    }

    //Push additional 0x01 on the witness stack, such that there is 0x01 on the stack when the execution suceeds
    in0WitnessStack.push(Buffer.from([0x01]));

    //Reverse the witness stack, because it is processed from last element to the first
    in0WitnessStack.reverse();

    //Push the p2wsh redeem script to the witness stack
    in0WitnessStack.push(script);

    tx.ins[0].witness = in0WitnessStack;
    tx.ins[1].witness = [
        secp256k1.publicKeyCreate(sighashNone.intermediateKey, true, Buffer),
        signP2WPKHInput(tx, 1, {
            script: sighashNone.intermediatePsbt.txOutputs[0].script,
            value: sighashNone.intermediatePsbt.txOutputs[0].value
        }, sighashNone.intermediateKey, 0x01)
    ];

    //Create transaction spending from 1st output of the claim transaction, to the recipient address
    const spendTx = new bitcoin.Transaction();
    spendTx.addInput(tx.getHash(), 0);
    spendTx.addOutput(bitcoin.address.toOutputScript(recipient), tx.outs[0].value-(140*feeRate));
    spendTx.ins[0].witness = [
        signP2WSHInput(spendTx, 0, {
            script: sighashSingle.claimScript,
            value: tx.outs[0].value
        }, sighashSingle.claimKey, 0x01),
        sighashSingle.claimScript
    ];

    const totalWork = sighashNone.work + sighashNoneA.work + sighashSingle.work + sighashAll.work;

    return {
        intermediatePsbt: sighashNone.intermediatePsbt,
        claimTx: tx,
        spendTx,
        expectedWork: work,
        totalWork
    };
}

module.exports = {
    grindTransaction,
    getAddress
};
