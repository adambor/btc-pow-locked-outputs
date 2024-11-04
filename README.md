# Bitcoin PoW-locked outputs with arbitrary difficulty

## Abstract

The best current way to do PoW-locked output scripts in bitcoin is to use signature grinding, this however doesn't allow smooth difficulty adjustments, as it works with byte size of the DER encoded signature, so the adjustment steps are either 256 times the prior difficulty to the the upside or prior difficulty divided by 256. Here we first present current way to do bitcoin script PoW locking with ECDSA signatures along with its limitations and then we present a new way of locking bitcoin outputs with fully arbitrary difficulty (the lowest difficulty being 2^18) by just using 12 signatures, a well-known short nonce and carefully choosen set of 12 private keys. Moreover the PoW is based on grinding the transaction hash (SHA-256d) and using simple comparisions in the 256-bit integer space, it involves no operations in the finite field or elliptic curve operations.

## Simple signature grinding

Signature grinding is based on the fact that ECDSA signatures in bitcoin are DER encoded, so they have variable size based on the amount of leading zero bytes in the signature's **r** & **s** values. The size of the DER encoded signature is 2 (DER prefix) + 2 (r value prefix) + size(**r**) + 2 (s value prefix) + size(**s**) + 1 (sighash flag) = 7 + size(**r**) + size(**s**), where size() is the encoded byte size of the variable, it's also important to note that encoded integers must always have their most signification bit set to 0, as that represents the sign of the integer (all integers in DER are signed).

The **r** value is the x coordinate of a signing nonce point (**r**=x_only(**k**\*G)), as discrete log is presumed to be hard in EC, one needs to grind through multiple nonces **k** to get the **r** value that has a pre-defined amount of leading zero bytes.

The **s** value can be computed as **s**=**k**^-1\*(z+**dr**), where z is the transaction hash, and **d** a private key, the miner can easily grind the transaction hash z here and check if the resulting **s** value has the required amount of leading zero bytes.

### Application

As we can only restrict the full length of the signature (including length changes from both **r** & **s** values combined) with OP_SIZE opcode, the best course of action for a miner is to use a short enough nonce, such that grinding **s** value will then be easier for him as he will require fewer leading zero bytes. This nonce can also be re-used because the private key locking the output is not a secret.

#### Base case

In the base case this would mean miners constantly running an algorithm trying to find the **k** value producing the **r** with most amount of leading zeto bytes and then using that **k** to grind the **s** value, since private key **d** is publicly known, everyone would get to know the **k** used to produce the short **r** (one can easily solve **s**=**k**^-1\*(z-**dr**) for **k** by knowing s, r, d & z) and other miners can now re-use it.

#### Using well known short nonce point

For the secp256k1 curve we already know of a specific **k**=1/2 value producing **r**=0x00000000000000000000003b78ce563f89a0ed9414f5aa28ad0d96d6795f9c63 with 11 leading zero bytes (88-bits). Producing a shorter **r** is highly unlikely as it would require grinding through 2^96 **k** values to have 50% chance of finding it. Therefore rational miners would just use this nonce and then grind just the transaction hash. Then the size of the DER encoded signature is 7 + 21 (well-known short **r** value) + **p**. We can therefore tune the difficulty of the PoW by adjusting **p**, then the work required is 2\*256^**p** (the 2 multiple is because of the most signficant bit having to be 0).

### Drawbacks

As can be seen from the equation above, the work can only scale in the powers of 256 (because **p** is an integer), so the difficulty can be either multiplied by 256 or divided by 256. One can use multiple signatures to allow for smoother difficulty adjustement e.g. 256 signatures can be used to allow for increments/decrements by 0.4%, however this is not practical due to P2WSH redeem script limitations such as 10kB of size & up to 201 of non-push opcodes.

## Mathematical structure of short signatures

For the signature value **s** to be short (have certain amount of leading zero bytes), we can say that **s** < 2^(8\*(32-**b**)-1), where **b** is the amount of leading zero bytes that we want to achieve. Let's look more closely into a specific case where we want to achieve 1 leading zero byte & use the well known short nonce **k** - the DER encoded signature size in this case is 59 bytes or less.

**s**=**k**^-1\*(**z**+**dr**) mod **n**; **s** < 2^247

Since comparison operators are not defined over a finite field (and calculation of **s** is done in the finite field modulo field order **n**), we can create a set of all the integers 0..(2^247-1) and then see if the s value is contained in this set, therefore we can write

**s** ∈ {i ∈ Z | i < 2^247}\
**k**^-1\*(**z**+**dr**) ∈ {i ∈ Z | i < 2^247}

**k** is 1/2 so the inverse is 2, and we can also let **x**=-**dr** mod **n**, since **d** is a constant private key and **r** is also a constant since we use a constant **k** (the minus sign will become apparent later).

2\*(**z**-**x**) ∈ {i ∈ Z | i < 2^247}\
(**z**-**x**) ∈ {i/2 | i < 2^247}

Which we can write as (keep in mind i/2 is division in the finite field)

(**z**-**x**) ∈ {i ∈ Z | i < 2^246} ∪ {i ∈ Z | **n** div 2 + 1 ≤ i < **n** div 2 + 1 + 2^246}, where div is integer division\
**z** ∈ {i + **x** mod **n**| i < 2^246} ∪ {i + **x** mod **n** | **n** div 2 + 1 ≤ i < **n** div 2 + 1 + 2^246}

**I(x)** = {i + **x** mod **n**| i < 2^246} ∪ {i + **x** mod **n** | **n** div 2 + 1 ≤ i < **n** div 2 + 1 + 2^246}\
**z** ∈ **I(x)**

This complicated-looking interval can be easily represented on the finite field circle

![FF circle single key](https://github.com/adambor/btc-pow-locked-outputs/blob/main/single-key-diagram.png)

What this shows is that the signature's s-value having at least 1 leading zero byte depends on the transaction hash **z** being in some interval **I(x)**, which is a function of the constant **x**=-**dr** and therefore depends only on the choosen private key **d** (**r** is fixed, since **k**=1/2). Moreover the interval always has the size of 2^247 field elements - hence when requiring just 1 leading zero byte the chance that any **z** will be in the interval is 2^247/**n** (n ~ 2^256) ~ 0.2%.

### Abitrary sized intervals

By using 2 private keys, and requiring that the miner produces short signatures for both of them over a single transaction hash we can make sure that the transaction hash is included in both of the intervals, or in other words the transaction hash is in the intersection of the 2 intervals.

Let **d1**, **d2** be the private keys, then **x1**=-**d1**\***r** and **x2**=-**d2**\***r**.\
**z** ∈ **I(x1)**\
**z** ∈ **I(x2)**\
**C(x1, x2)** = **I(x1)** ∩ **I(x2)**\
**z** ∈ **C(x1, x2)**

![FF circle two key](https://github.com/adambor/btc-pow-locked-outputs/blob/main/two-key-diagram.png)

The interval **C(x1,x2)** (dotted area on the circle) can therefore be of aribtrary size, the size of **C** (how many element it contains) can be calculated as 2^247-2\*∆x, where ∆x = abs(x1-x2). The chance that any **z** will be in the interval is P(∆x) = (2^247-2\*∆x)/**n**, or in other words, the work required is W(∆x) = **n**/(2^247-2\*∆x). This way we can fine-tune the chance that any transaction hash **z** will be in the interval (produce short s-values for both private keys) and therefore adjust the amount of work required to satisfy the output script. We still need to make sure that the transaction hash **z** is the same for both signatures, since miner can use different sighashes, and in that case transaction hash for the 2 signatures is not the same.

### Non-overlapping intervals

If we were to use ∆x>2^246, the size of the interval turns negative i.e. intersection of the interval becomes an empty set **C**=∅. We can therefore be sure that it is impossible to produce short s-values for both private keys over the same transaction hash, so if this happens we can be sure that 2 signatures are produced over different transaction hashes (i.e. different sighash flag in bitcoin). This means that if we use 2 private keys with their corresponding **x** values (recall **x**=-**dr** mod **n**) further than 2^246 apart from each other (such that their intervals **I(x)** don't overlap) we can force the miner to use 2 different sighashes. By extension if we use 6 private keys that produce non-overlapping intervals we can force the miner to use all 6 possible sighashes possible on bitcoin today.

## Arbitrary difficulty signature grinding

We will use a mix of overlapping & non-overlapping intervals to force the miner to produce signatures under all the sighashes, making sure that the signatures supplied to the overlapping interval pairs use the same transaction hash (have the same sighash flag).

Let ∆x be a pre-selected offset between private key **x** values defining the difficulty of the PoW output, we will create a set of 6 pairs of private keys (here represented by their corresponding **x** value, one can simply calculate private key **d**=-**x**/**r** mod **n**), where private keys in pair have an overlap defined by ∆x and different pairs have no overlap.

(x1a, x1b) = (1, 1 + ∆x)\
(x2a, x2b) = (2^248 + 1, 2^248 + 1 + ∆x)\
(x3a, x3b) = (2\*2^248 + 1, 2\*2^248 + 1 + ∆x)\
(x4a, x4b) = (3\*2^248 + 1, 3\*2^248 + 1 + ∆x)\
(x5a, x5b) = (4\*2^248 + 1, 4\*2^248 + 1 + ∆x)\
(x6a, x6b) = (5\*2^248 + 1, 5\*2^248 + 1 + ∆x)

This forces the miner to use a different sighash flag for every one of the 6 intervals defined by overlapping interval private key pairs, ensuring that our need for both signatures to use the same transaction hash for overlapping intervals holds.

### Estimating difficulty

A naive approach would be to say that the difficulty (work required) in this construction is (W(∆x)^6)/6! - as we need to hit 6 different transaction hashes **z** within a pre-specified intervals. It is important to note however that some sighashes can be independent of each other. Here is a table of bitcoin sighashes and their dependencies in a 2-input & 2-output bitcoin transaction:

| Sighash flag                   |                   |         |         |          |          |
|--------------------------------|-------------------|---------|---------|----------|----------|
| SIGHASH_NONE \| ANYONECANPAY   | locktime, version | input 0 |         |          |          |
| SIGHASH_NONE                   | locktime, version | input 0 | input 1 |          |          |
| SIGHASH_SINGLE \| ANYONECANPAY | locktime, version | input 0 |         | output 0 |          |
| SIGHASH_SINGLE                 | locktime, version | input 0 | input 1 | output 0 |          |
| SIGHASH_ALL \| ANYONECANPAY    | locktime, version | input 0 |         | output 0 | output 1 |
| SIGHASH_ALL                    | locktime, version | input 0 | input 1 | output 0 | output 1 |

Therefore the optimal way to produce all the required hashes/signatures is as follows:

1. SIGHASH_NONE \| ANYONECANPAY - grind the transaction locktime & input 0 nSequence number to get a valid transaction hash in any of the intervals, work required is W(∆x)/6
2. SIGHASH_NONE - grind the input 1, since only UTXO transaction hash & vout is used in the transaction hash we need to create an intermediate transaction, whose UTXO we will use as input 1 and then grind the transaction id of this intermediate transacton, which will affect the transaction hash of this transaction, work required is W(∆x)/5, however as we need to do 2x more hashing (since we also need to hash the intermediate transaction every time) the real work is 2*W(∆x)/5
3. SIGHASH_SINGLE \| ANYONECANPAY and SIGHASH_SINGLE - these need to be done together, since only difference between them is the input 1, which was already set in step 2, we can grind the output 0 locking script or value, the work required is W(∆x)^2/4\*3
4. SIGHASH_ALL \| ANYONECANPAY and SIGHASH_ALL - these also need to be done together, since only difference between them is again just the input 1, which was already set in step 2, we can grind the output 1 locking script or value, the work required is W(∆x)^2/2\*1

We can therefore express the total work that needs to be done by a miner as **Wt(∆x)** = **W(∆x)**/6 + 2\***W(∆x)**/5+ **W(∆x)**^2/4\*3 + **W(∆x)**^2/2. Based on this equation we can derive an equation for calculating **∆x** from the required work **Wt**.

**Wt(∆x)** = **W(∆x)**/6 + 2\***W(∆x)**/5 + **W(∆x)**^2/4\*3 + **W(∆x)**^2/2\
**Wt(∆x)** = 17/30\***W(∆x)** + 7/12\***W(∆x)**^2\
0 = 7/12\***W(∆x)**^2 + 17/30\***W(∆x)** - **Wt(∆x)**

**W(∆x)** = (-17/30 + sqrt(289/900 + 7/3\***Wt(∆x)**))/(7/6)\
**W(∆x)** = 1/105*(3\*sqrt(289+2100\***Wt(∆x)**) - 51)\
**n**/(2^248-2**∆x**) = 1/105*(3\*sqrt(289+2100\***Wt(∆x)**) - 51)\
2^247-2**∆x** = 105**n**/(3\*sqrt(289+2100\***Wt(∆x)**) - 51)

**∆x** = 105**n**/(102 - 6\*sqrt(289+2100\***Wt(∆x)**)) + 2^246

### Claim transaction structure

The claim transaction needs to be carefully crafted as to not allow other miners to gain advantage from it.

If the claim transaction is already published in the mempool, it makes it a bit easier to mine for others as they can re-use the short signatures for SIGHASH_NONE \| ANYONECANPAY, this is not signficant though, since grinding the SIGHASH_NONE \| ANYONECANPAY is the easiest (total work contribution is just **W(∆x)**/6, compared to e.g. **W(∆x)**^2/2 for both SIGHASH_ALL & ANYONECANPAY) - this is something we cannot eliminate.

Other miners could also re-use SIGHASH_SINGLE \| ANYONECANPAY, but this would mean they cannot change the output 0 of the transaction, it is therefore required to put the most significant output (e.g. the payout output) as the first output of the transaction. Same applies for SIGHASH_ALL \| ANYONECANPAY, however this is already covered by just using the output 0 of the transaction as the most significant output.

To prevent other miners from re-using non-ANYONECANPAY signatures, the input 1 of the transaction should be a P2WPKH utxo, signed with SIGHASH_ALL, changing the transaction in any way would therefore invalidate the signature of this input.

| Inputs                                        | Outputs                                 |
|-----------------------------------------------|-----------------------------------------|
| input0: PoW-locked UTXO                       | output0: Most significant (e.g. payout) |
| input1: P2WPKH UTXO (signed with SIGHASH_ALL) | output1: Insignificant (e.g. OP_RETURN) |

### Example

There is a Node.JS application in /example directory of the repo, allowing you to create & mine PoW-locked output with arbitrary difficulty (work). Here is a detailed example of how the code actually works.

#### Setup

A simple example for constructing an output with a difficulty of 2^18 (a miner on average has to go through 262144 hashes to find a solution) - all numbers are in hexadecimal.

Field order **n** = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141\
Required work **Wt** = 0x40000\
**∆x** = 0x000f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc163

Interval pairs (**x** values)

(x1a, x1b) = (0x0000000000000000000000000000000000000000000000000000000000000001, 0x000f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164)\
(x2a, x2b) = (0x0100000000000000000000000000000000000000000000000000000000000001, 0x010f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164)\
(x3a, x3b) = (0x0200000000000000000000000000000000000000000000000000000000000001, 0x020f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164)\
(x4a, x4b) = (0x0300000000000000000000000000000000000000000000000000000000000001, 0x030f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164)\
(x5a, x5b) = (0x0400000000000000000000000000000000000000000000000000000000000001, 0x040f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164)\
(x6a, x6b) = (0x0500000000000000000000000000000000000000000000000000000000000001, 0x050f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164)

Derive private key pairs from the **x** value pairs, **d**=-**x**/**r** mod **n**

(d1a, d1b) = (0x714c150e7cc990721378a2c2e5793c970352349ca849e07402b70a634efca6fd, 0xa0cc0ae9058236ed8b9791845c0533cf2c8371f96ee9b9db36bfcdf3e6eb8cd6)\
(d2a, d2b) = (0x55bbf0ee65ba65767b8ce233c711b1fcae7c097ac42a5977ba1876c7ce530395, 0x853be6c8ee730bf1f3abd0f53d9da934d7ad46d78aca32deee213a586641e96e)\
(d3a, d3b) = (0x3a2bccce4eab3a7ae3a121a4a8aa276259a5de58e00ad27b7179e32c4da9602d, 0x69abc2a8d763e0f65bc010661f361e9a82d71bb5a6aaabe2a582a6bce5984606)\
(d4a, d4b) = (0x1e9ba8ae379c0f7f4bb561158a429cc804cfb336fbeb4b7f28db4f90ccffbcc5, 0x4e1b9e88c054b5fac3d44fd700ce94002e00f093c28b24e65ce4132164eea29e)\
(d5a, d5b) = (0x030b848e208ce483b3c9a0866bdb122daff9881517cbc482e03cbbf54c56195d, 0x328b7a68a9458aff2be88f47e2670965d92ac571de6b9dea14457f85e444ff36)\
(d6a, d6b) = (0xe77b606e097db9881bdddff74d73879215d239d9e2f4ddc2577086e69be2b736, 0x16fb56489236600393fcceb8c3ff7ecb84549a4ffa4c16edcba6ebea639b5bce)

Finally derive public keys from the private key pairs, **P**=**d**\*G, here the public keys are expressed in their compressed form.

(P1a, P1b) = (02f8f1e55f7349f7ab27c078a916ec02e055164fc7e69fc23e402fa9809acfd4f4, 029472f72b94a45f0580aa1fa4556710f314c90131c2ca6008a6654610889dd954)\
(P2a, P2b) = (037309a5ba25f35a9fac04bba70ff53fad7e571b204fae5b15823d2043536b874e, 025432596e0bc862a0600c33ab8ae3894178aec2609ff2f61302a2c101542a0031)\
(P3a, P3b) = (02df8c2213cd1e506a71188075614630380cefb5e1f4ae403ce43a0c55eb3666f3, 031395738095ed0121e2747cb47473d1a25af083312d4fb58c66de32315fe2701d)\
(P4a, P4b) = (03a4dc09a46077c7f58be8a70a9bff31637b58a94ebbe85215449da0f647be90b0, 02c8aa00ccde29e951e77c1d891a09f996f2484dff7d5e061a8bc5705c7074bc0b)\
(P5a, P5b) = (02dada669eeafb333374f467c3514f7b2dfcc57a67b659c2da4f989f53b4c71875, 022ba85a0fe3eef9d9144ee70ac2d9e8487954ca4cc27450be5641721a6b3852eb)\
(P6a, P6b) = (035df4a0bb365ba44df94e9bd2f343111e17d74e26afbe525e9c629c967a53da6f, 027bcbda9aa7d2ca15499e56e819f3144f805c35e5724e050fac30542f9746ccf2)

Now we can create a locking script requiring that the signature sizes under all the public keys be of 59 bytes or less

```
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02f8f1e55f7349f7ab27c078a916ec02e055164fc7e69fc23e402fa9809acfd4f4 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 029472f72b94a45f0580aa1fa4556710f314c90131c2ca6008a6654610889dd954 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 037309a5ba25f35a9fac04bba70ff53fad7e571b204fae5b15823d2043536b874e OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 025432596e0bc862a0600c33ab8ae3894178aec2609ff2f61302a2c101542a0031 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02df8c2213cd1e506a71188075614630380cefb5e1f4ae403ce43a0c55eb3666f3 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 031395738095ed0121e2747cb47473d1a25af083312d4fb58c66de32315fe2701d OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 03a4dc09a46077c7f58be8a70a9bff31637b58a94ebbe85215449da0f647be90b0 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02c8aa00ccde29e951e77c1d891a09f996f2484dff7d5e061a8bc5705c7074bc0b OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02dada669eeafb333374f467c3514f7b2dfcc57a67b659c2da4f989f53b4c71875 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 022ba85a0fe3eef9d9144ee70ac2d9e8487954ca4cc27450be5641721a6b3852eb OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 035df4a0bb365ba44df94e9bd2f343111e17d74e26afbe525e9c629c967a53da6f OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 027bcbda9aa7d2ca15499e56e819f3144f805c35e5724e050fac30542f9746ccf2 OP_CHECKSIGVERIFY
```

A P2WSH address of the above redeem script on testnet results in: tb1qtcsnxzxefxvv0jqe9ax5mq45fcn4lv6rttccuhe97g3057py7wuqgnuz40

Finally we can fund the address output with some amount of BTC which will be a reward for the miner. Like transaction [2c6747829c435da3be23ba350c7d5eab5b9fb8717de2613973191305779e3075](https://mempool.space/testnet4/tx/2c6747829c435da3be23ba350c7d5eab5b9fb8717de2613973191305779e3075#vout=0) on testnet.

#### Mining/grinding

An example for mining the PoW locked output. We will use the output created above and go through the steps required to mine it.

UTXO of the PoW locked output: [2c6747829c435da3be23ba350c7d5eab5b9fb8717de2613973191305779e3075:0](https://mempool.space/testnet4/tx/2c6747829c435da3be23ba350c7d5eab5b9fb8717de2613973191305779e3075#vout=0)

We will also need a UTXO that we control, to be used in the intermediate transaction that we will use for grinding SIGHASH_NONE. 

UTXO for the intermediate transaction: [63e0fcd8c7a828dc979da397fa82fdd7d8e49b9d5a693273fbd98813f254299c:1](https://mempool.space/testnet4/tx/63e0fcd8c7a828dc979da397fa82fdd7d8e49b9d5a693273fbd98813f254299c#vout=1)

##### Preparation

Convert the **x** pairs to intervals of transaction hash, the interval is always in the form **Cn** = \[**xnb**, **xna**+2^246) ∪ \[**xnb**+(**n** div 2)+1, **xna**+2^246+(**n** div 2)+1)

C1 = \[0x000f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164, 0x0040000000000000000000000000000000000000000000000000000000000001) ∪ \[0x800f1504f7dd7ed3811e84e2e680f49644be44caf5d6c9870949b08ac3c7e205, 0x803fffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a2)\
C2 = \[0x010f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164, 0x0140000000000000000000000000000000000000000000000000000000000001) ∪ \[0x810f1504f7dd7ed3811e84e2e680f49644be44caf5d6c9870949b08ac3c7e205, 0x813fffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a2)\
C3 = \[0x020f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164, 0x0240000000000000000000000000000000000000000000000000000000000001) ∪ \[0x820f1504f7dd7ed3811e84e2e680f49644be44caf5d6c9870949b08ac3c7e205, 0x823fffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a2)\
C4 = \[0x030f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164, 0x0340000000000000000000000000000000000000000000000000000000000001) ∪ \[0x830f1504f7dd7ed3811e84e2e680f49644be44caf5d6c9870949b08ac3c7e205, 0x833fffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a2)\
C5 = \[0x040f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164, 0x0440000000000000000000000000000000000000000000000000000000000001) ∪ \[0x840f1504f7dd7ed3811e84e2e680f49644be44caf5d6c9870949b08ac3c7e205, 0x843fffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a2)\
C6 = \[0x050f1504f7dd7ed3811e84e2e680f496e766d6579e327969296081445bacc164, 0x0540000000000000000000000000000000000000000000000000000000000001) ∪ \[0x850f1504f7dd7ed3811e84e2e680f49644be44caf5d6c9870949b08ac3c7e205, 0x853fffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a2)

##### Grinding

###### SIGHASH_NONE \| ANYONECANPAY

We can vary this sighash by incrementing the nSequence of the input 0 (this can go from 0 to 2^31) & timelock of the transaction (this can go from 500000000 to 1700000000).

Using locktime=500000000 & input 0's nSequence=11 produces a valid sighash=0x032c7a1ced956bf3847a1063ac6e283e06554142ead66b194d3478ab4e46845a which is contained in the interval **C4**.

###### SIGHASH_NONE

For this we need to create intermediate transaction using the intermediate UTXO provided, such that we can vary its txId by changing intermediate tx's locktime & nSequence fields.

We first create an ephemeral key **de**=0x3f45d97dc47b0c2eefb61d94b6855a58247f8fdb256048d5ab65e71273031893 that will be used for the output of the intermediate tx, with corresponding public key **Pe**=034d1f488236a356bbc6ddcdaaaed2472af502b0206fd3b036c82f656aa30c7bb7 and P2WPKH locking script 0014366bf8aaf0e672d2c28b2a4e1c5d6a6dcb1048f6.

We create an intermediate transaction like so:

| Inputs                                                             | Outputs                                                                                |
|--------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| 63e0fcd8c7a828dc979da397fa82fdd7d8e49b9d5a693273fbd98813f254299c:1 | P2WPKH(034d1f488236a356bbc6ddcdaaaed2472af502b0206fd3b036c82f656aa30c7bb7): 18190 sats |

Which is then used in the claim transaction like so:

| Inputs                                                             |
|--------------------------------------------------------------------|
| 2c6747829c435da3be23ba350c7d5eab5b9fb8717de2613973191305779e3075:0 |
| \<intermediate txId\>:0                                              |

We can now start incrementing nSequence of the input 0 of the intermediate transaction (this can go from 0 to 2^31) & timelock of the intermediate transaction (this can go from 500000000 to 1700000000).

Using locktime=500000000 & input 0's nSequence=200 produces an intermediate transaction txId=23990f08e0e7cb6e22ea1837241d5884c84d2398a82f5469e63d022ce215e84f, which when used as input 1 of the claim transaction creates a valid sighash=0x051c2fb4ae682f4598c45146ec16fcd1944fa7b674571dbb4f3ba9c85c79bd6f which is contained in the interval **C6**.

###### SIGHASH\_SINGLE and SIGHASH\_SINGLE \| ANYONECANPAY

We need to grind these 2 together, since we have no way to influence one without also changing the other. We do this by changing the output 0's script. To do this we could simply generate random private keys & P2WPKH locking scripts to them, however this means generating public keys from private keys which is orders of magnitude slow than hashing. We will therefore use a P2WSH script which includes the nonce and then simply drops it from the stack & then verifies the signature. The redeem script looks like this:

```
<nonce> OP_DROP <public key> OP_CHECKSIGVERIFY OP_1
```

Using this we can simply change the nonce to change the script hash and influence the P2WSH output script, while keeping the same public key.

We create a random claim key **dc**=0x6484e2ecd66d7b834272e26a82aa9115b7b0591dca5b6b17ca316d58fe00a297, with its corresponding public key **Pc**=02b0db6b93ed9284dc957718faf3f1464cf2a47f35c12ddc1783cbebed3952d3dbad.

Now we can start incrementing the nonce in the P2WSH output script.

Using nonce=44966 we get the following P2WSH redeem script:

```
afa6 OP_DROP 02b0db6b93ed9284dc957718faf3f1464cf2a47f35c12ddc1783cbebed3952d3dbad OP_CHECKSIGVERIFY OP_1
```

Which translates to the output script 00200369b6c884a12874f75c3d1285ca2a7119f0d977e0c60f84034b31291c6ce9fe and produces a valid sighashes - sighash(SIGHASH\_SINGLE)=0x012a4533d9bbc900bf5757dcc6b2f3aa8925a2fbc42708afe22b0921124f62a2 which is contained in the interval **C2** & sighash(SIGHASH\_SINGLE \| ANYONECANPAY)=0x841d8ccc1fa672da928aae66b5a1653a227abc1fedab8a55d1c0300cf4337a33 which is contained in the interval **C5**

###### SIGHASH\_ALL and SIGHASH\_ALL \| ANYONECANPAY

We again need to grind these 2 together, since we have no way to influence one without also changing the other. We do this by changing output 1's output script, here we can simply use OP_RETURN.

```
OP_RETURN <nonce>
```

Now we can start incrementing the nonce in the OP_RETURN output.

Using nonce=68976 we get valid sighashes - sighash(SIGHASH\_ALL)=0x022a721e26c9115172fc219abde406bab532df328fc83c16e8820a82f9bada6a which is contained in the interval **C3** & sighash(SIGHASH\_ALL \| ANYONECANPAY)=0x803fcf5814aa36a5d6488fdf26d949b5871f29764b20842170cbbccce4eb15e4 which is contained in **C1**

##### Transactions

We now have a valid set of transactions

###### Intermediate transaction

locktime=500000000

| Inputs                                                                             | Outputs                                                                                |
|------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| 63e0fcd8c7a828dc979da397fa82fdd7d8e49b9d5a693273fbd98813f254299c:1, nSequence: 200 | P2WPKH(034d1f488236a356bbc6ddcdaaaed2472af502b0206fd3b036c82f656aa30c7bb7): 18190 sats |

txId = [23990f08e0e7cb6e22ea1837241d5884c84d2398a82f5469e63d022ce215e84f](https://mempool.space/testnet4/tx/23990f08e0e7cb6e22ea1837241d5884c84d2398a82f5469e63d022ce215e84f)

###### Claim transaction

locktime=500000000

| Inputs                                                                           | Outputs                                                                                                                   |
|----------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| 2c6747829c435da3be23ba350c7d5eab5b9fb8717de2613973191305779e3075:0, nSequence=11 | P2WSH(afa6 OP_DROP 02b0db6b93ed9284dc957718faf3f1464cf2a47f35c12ddc1783cbebed3952d3db OP_CHECKSIGVERIFY OP_1): 18690 sats |
| 23990f08e0e7cb6e22ea1837241d5884c84d2398a82f5469e63d022ce215e84f:0, nSequence=0  | OP_RETURN 010d70: 0 sats                                                                                                  |

txId=[4017bedd84d88658291797d8cd9751fa20fa1216b1cf34cf808331c4522c66b3](https://mempool.space/testnet4/tx/4017bedd84d88658291797d8cd9751fa20fa1216b1cf34cf808331c4522c66b3)

We produce valid signatures by using the corresponding intervals & their private keys:

1. Interval C1 was hit by SIGHASH\_ALL \| ANYONECANPAY, therefore we take private keys **d1a** & **d1b**, and sign the transaction with SIGHASH\_ALL \| ANYONECANPAY by them.
2. Interval C2 was hit by SIGHASH\_SINGLE, therefore we take private keys **d2a** & **d2b**, and sign the transaction with SIGHASH\_SINGLE by them.
3. Interval C3 was hit by SIGHASH\_ALL, therefore we take private keys **d3a** & **d3b**, and sign the transaction with SIGHASH\_ALL by them.
4. Interval C4 was hit by SIGHASH\_NONE \| ANYONECANPAY, therefore we take private keys **d4a** & **d4b**, and sign the transaction with SIGHASH\_NONE \| ANYONECANPAY by them.
5. Interval C5 was hit by SIGHASH\_SINGLE \| ANYONECANPAY, therefore we take private keys **d5a** & **d5b**, and sign the transaction with SIGHASH\_SINGLE \| ANYONECANPAY by them.
6. Interval C6 was hit by SIGHASH\_NONE, therefore we take private keys **d6a** & **d6b**, and sign the transaction with SIGHASH\_NONE by them.

###### Spend transaction

Locktime or nSequences are not important here 

| Inputs                                                             | Outputs                                                |
|--------------------------------------------------------------------|--------------------------------------------------------|
| 4017bedd84d88658291797d8cd9751fa20fa1216b1cf34cf808331c4522c66b3:0 | tb1qcjrfydsykze2htqcp6thau3v7nk5hndrsywwv6: 18550 sats |

txId=[921ba28a5f30060e8771efb9b47e83fd3d36d9f69948af2d225760a269675fca](https://mempool.space/testnet4/tx/921ba28a5f30060e8771efb9b47e83fd3d36d9f69948af2d225760a269675fca)

### Edge cases

#### Not enough variety for SIGHASH_NONE \| ANYONECANPAY

It might happen that in case the difficulty is high enough, the grinding for SIGHASH_NONE \| ANYONECANPAY couldn't find any valid solution by grinding the transaction locktime (around 1200000000 possibilities) & input 0's nSequence (around 2^31 possibilities with the most significant enable bit being 0 to ensure no consensus meaning) - in total around ~2^61 possibilities, in that case only other option is to start grinding transaction version, resulting in the total of ~2^93 possibilities - this will however make the transaction non-standard and it will have to be broadcasted directly to a miner to include it in the block. This is unlikely to happen anytime soon though, as even with the bitcoin's current block difficulty the chance of it happening is just \~1:10^8.

### Improvements

Miners can cache intermediary states of sha256 hash function when grinding just parts of the transaction to speed up the process, they can also cache sha256 hashes of outputs & inputs, respectively when changing the other.
