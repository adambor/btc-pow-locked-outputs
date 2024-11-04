
const mempoolUrl = "https://mempool.space";

/**
 *
 * @param txId {string}
 * @param vout {number}
 * @param network {string}
 */
async function getWitnessUtxo(txId, vout, network) {
    const path = network==="mainnet" ? "/api/tx/" : "/"+network+"/api/tx/";
    const response = await fetch(mempoolUrl+path+txId);
    if(!response.ok) throw new Error("Transaction "+txId+" not found!");
    const obj = await response.json();
    const txOut = obj.vout[vout];
    if(txOut==null) throw new Error("Transaction "+txId+" doesn't have vout "+vout);
    return {
        txId,
        vout,
        script: Buffer.from(txOut.scriptpubkey, "hex"),
        value: txOut.value
    };
}

module.exports = {
    getWitnessUtxo
};
