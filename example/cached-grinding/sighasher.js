const bitcoin = require("bitcoinjs-lib");
const crypto = require("crypto");
const varuint = require('varuint-bitcoin');

const ZERO = Buffer.alloc(32, 0);

function hash256(data) {
    return crypto.createHash("sha256").update(
        crypto.createHash("sha256").update(data).digest()
    ).digest();
}

/**
 *
 * @param tx {bitcoin.Transaction}
 * @param inIndex {number}
 * @param prevOutScript {Buffer}
 * @param value {number}
 * @param hashType {number}
 * @param sighashCache {{hashOutputs?: Buffer, hashSequence?: Buffer, hashPrevouts?: Buffer}}
 * @returns {Buffer}
 */
function hashForWitnessV0(tx, inIndex, prevOutScript, value, hashType, sighashCache) {
    sighashCache ??= {};
    let tbuffer = Buffer.from([]);
    if (!(hashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY) && !sighashCache.hashPrevouts) {
        tbuffer = Buffer.allocUnsafe(36 * tx.ins.length);
        tx.ins.forEach((txIn, index) => {
            txIn.hash.copy(tbuffer, index * 36);
            tbuffer.writeUInt32LE(txIn.index, (index * 36) + 32);
        });
        sighashCache.hashPrevouts = hash256(tbuffer);
        // console.log("hashPrevouts: ", hashPrevouts.toString("hex"));
    }
    if (
        !(hashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY) &&
        (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_SINGLE &&
        (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_NONE &&
        !sighashCache.hashSequence
    ) {
        tbuffer = Buffer.allocUnsafe(4 * tx.ins.length);
        tx.ins.forEach((txIn, index) => {
            tbuffer.writeUInt32LE(txIn.sequence, index * 4);
        });
        sighashCache.hashSequence = hash256(tbuffer);
        // console.log("hashSequence: ", hashSequence.toString("hex"));
    }
    if (
        (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_SINGLE &&
        (hashType & 0x1f) !== bitcoin.Transaction.SIGHASH_NONE &&
        !sighashCache.hashOutputs
    ) {
        const txOutsSize = tx.outs.reduce((sum, output) => {
            return sum + 8 + varuint.encodingLength(output.script.length) + output.script.length;
        }, 0);
        tbuffer = Buffer.allocUnsafe(txOutsSize);
        let pointer = 0;
        tx.outs.forEach(out => {
            tbuffer.writeBigUInt64LE(BigInt(out.value), pointer);
            pointer += 8;
            const lengthPrefix = varuint.encode(out.script.length);
            lengthPrefix.copy(tbuffer, pointer);
            pointer += lengthPrefix.length;
            out.script.copy(tbuffer, pointer);
            pointer += out.script.length;
        });
        sighashCache.hashOutputs = hash256(tbuffer);
        // console.log("hashOutputs: ", hashOutputs.toString("hex"));
    } else if (
        (hashType & 0x1f) === bitcoin.Transaction.SIGHASH_SINGLE &&
        inIndex < tx.outs.length &&
        !sighashCache.hashOutputs
    ) {
        const output = tx.outs[inIndex];
        tbuffer = Buffer.allocUnsafe(8 + varuint.encodingLength(output.script.length) + output.script.length);
        tbuffer.writeBigUInt64LE(BigInt(output.value), 0);
        const lengthPrefix = varuint.encode(output.script.length);
        lengthPrefix.copy(tbuffer, 8);
        output.script.copy(tbuffer, 8 + lengthPrefix.length);
        sighashCache.hashOutputs = hash256(tbuffer);
        // console.log("hashOutputs: ", hashOutputs.toString("hex"));
    }

    sighashCache.hashOutputs ??= ZERO;
    sighashCache.hashPrevouts ??= ZERO;
    sighashCache.hashSequence ??= ZERO;

    tbuffer = Buffer.allocUnsafe(156 + varuint.encodingLength(prevOutScript.length) + prevOutScript.length);
    const input = tx.ins[inIndex];
    tbuffer.writeInt32LE(tx.version);
    sighashCache.hashPrevouts.copy(tbuffer, 4);
    sighashCache.hashSequence.copy(tbuffer, 36);
    input.hash.copy(tbuffer, 68);
    tbuffer.writeUInt32LE(input.index, 100);

    let pointer = 104;
    const lengthPrefix = varuint.encode(prevOutScript.length);
    lengthPrefix.copy(tbuffer, pointer);
    pointer += lengthPrefix.length;
    prevOutScript.copy(tbuffer, pointer);
    pointer += prevOutScript.length;

    tbuffer.writeBigUInt64LE(BigInt(value), pointer);
    pointer += 8;

    tbuffer.writeUInt32LE(input.sequence, pointer);
    pointer += 4;
    sighashCache.hashOutputs.copy(tbuffer, pointer);
    pointer += 32;
    tbuffer.writeUInt32LE(tx.locktime, pointer);
    pointer += 4;
    tbuffer.writeUInt32LE(hashType, pointer);

    // console.log("finalSign: ", tbuffer.toString("hex"));

    return hash256(tbuffer);
}

module.exports = {
    hashForWitnessV0
};
