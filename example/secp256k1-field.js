const BN = require("bn.js");

//secp256k1 field order
const n = new BN("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16);

function invert(a) {
    if(a==null) return null;
    let t = new BN(0);
    let r = n;
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
        return t.add(n);
    }
    return t;
}

function mul(a, b) {
    if(a==null || b==null) return null;
    return a.mul(b).mod(n);
}

function negate(a) {
    return n.sub(a.mod(n));
}

function div(a, b) {
    return mul(a, invert(b));
}

module.exports = {
    n,
    invert,
    mul,
    negate,
    div
};
