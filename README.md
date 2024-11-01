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

**s** ∈ {i ∈ Z | i < 2^247}
**k**^-1\*(**z**+**dr**) ∈ {i ∈ Z | i < 2^247}

**k** is 1/2 so the inverse is 2, and we can also let **x**=-**dr** mod **n**, since **d** is a constant private key and **r** is also a constant since we use a constant **k** (the minus sign will become apparent later).

2\*(**z**-**x**) ∈ {i ∈ Z | i < 2^247}
(**z**-**x**) ∈ {i/2 | i < 2^247}

Which we can write as (keep in mind i/2 is division in the finite field)

(**z**-**x**) ∈ {i ∈ Z | i < 2^246} ∪ {i ∈ Z | **n** div 2 + 1 ≤ i < **n** div 2 + 1 + 2^246}, where div is integer division
**z** ∈ {i + **x** mod **n**| i < 2^246} ∪ {i + **x** mod **n** | **n** div 2 + 1 ≤ i < **n** div 2 + 1 + 2^246}

**I(x)** = {i + **x** mod **n**| i < 2^246} ∪ {i + **x** mod **n** | **n** div 2 + 1 ≤ i < **n** div 2 + 1 + 2^246}
**z** ∈ **I(x)**

This complicated-looking interval can be easily represented on the finite field circle

!(FF circle single key)[]

What this shows is that the signature's s-value having at least 1 leading zero byte depends on the transaction hash **z** being in some interval **I(x)**, which is a function of the constant **x**=-**dr** and therefore depends only on the choosen private key **d** (**r** is fixed, since **k**=1/2). Moreover the interval always has the size of 2^247 field elements - hence when requiring just 1 leading zero byte the chance that any **z** will be in the interval is 2^247/**n** (n ~ 2^256) ~ 0.2%.

### Abitrary sized intervals

By using 2 private keys, and requiring that the miner produces short signatures for both of them over a single transaction hash we can make sure that the transaction hash is included in both of the intervals, or in other words the transaction hash is in the intersection of the 2 intervals.

Let **d1**, **d2** be the private keys, then **x1**=-**d1**\***r** and **x2**=-**d2**\***r**.
**z** ∈ **I(x1)**
**z** ∈ **I(x2)**
**C(x1, x2)** = **I(x1)** ∩ **I(x2)**
**z** ∈ **C(x1, x2)**

!(FF circle two keys)[]

The interval **C(x1,x2)** can therefore be of aribtrary size, the size of **C** (how many element it contains) can be calculated as 2^247-2\*∆x, where ∆x = abs(x1-x2). The chance that any **z** will be in the interval is P(∆x) = (2^247-2\*∆x)/**n**, or in other words, the work required is W(∆x) = **n**/(2^247-2\*∆x). This way we can fine-tune the chance that any transaction hash **z** will be in the interval (produce short s-values for both private keys) and therefore adjust the amount of work required to satisfy the output script. We still need to make sure that the transaction hash **z** is the same for both signatures, since miner can use different sighashes, and in that case transaction hash for the 2 signatures is not the same.

### Non-overlapping intervals

If we were to use ∆x>2^246, the size of the interval turns negative i.e. intersection of the interval becomes an empty set **C**=∅. We can therefore be sure that it is impossible to produce short s-values for both private keys over the same transaction hash, so if this happens we can be sure that 2 signatures are produced over different transaction hashes (i.e. different sighash flag in bitcoin). This means that if we use 2 private keys with their corresponding **x** values (recall **x**=-**dr** mod **n**) further than 2^246 apart from each other (such that their intervals **I(x)** don't overlap) we can force the miner to use 2 different sighashes. By extension if we use 6 private keys that produce non-overlapping intervals we can force the miner to use all 6 possible sighashes possible on bitcoin today.

## Arbitrary difficulty signature grinding

We will use a mix of overlapping & non-overlapping intervals to force the miner to produce signatures under all the sighashes, making sure that the signatures supplied to the overlapping interval pairs use the same transaction hash (have the same sighash flag).

Let ∆x be a pre-selected offset between private key **x** values defining the difficulty of the PoW output, we will create a set of 6 pairs of private keys (here represented by their corresponding **x** value, one can simply calculate private key **d**=-**x**/**r** mod **n**), where private keys in pair have an overlap defined by ∆x and different pairs have no overlap.

(x1a, x1b) = (1, 1 + ∆x)
(x2a, x2b) = (2^248 + 1, 2^248 + 1 + ∆x)
(x3a, x3b) = (2\*2^248 + 1, 2\*2^248 + 1 + ∆x)
(x4a, x4b) = (3\*2^248 + 1, 3\*2^248 + 1 + ∆x)
(x5a, x5b) = (4\*2^248 + 1, 4\*2^248 + 1 + ∆x)
(x6a, x6b) = (5\*2^248 + 1, 5\*2^248 + 1 + ∆x)

This forces the miner to use a different sighash flag for every one of the 6 intervals defined by overlapping interval private key pairs, ensuring that our need for both signatures to use the same transaction hash for overlapping intervals holds.

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

**Wt(∆x)** = **W(∆x)**/6 + 2\***W(∆x)**/5 + **W(∆x)**^2/4\*3 + **W(∆x)**^2/2
**Wt(∆x)** = 17/30\***W(∆x)** + 7/12\***W(∆x)**^2
0 = 7/12\***W(∆x)**^2 + 17/30\***W(∆x)** - **Wt(∆x)**

**W(∆x)** = (-17/30 + sqrt(289/900 + 7/3\***Wt(∆x)**))/(7/6)
**W(∆x)** = 1/105*(3\*sqrt(289+2100\***Wt(∆x)**) - 51)
**n**/(2^248-2**∆x**) = 1/105*(3\*sqrt(289+2100\***Wt(∆x)**) - 51)
2^247-2**∆x** = 105**n**/(3\*sqrt(289+2100\***Wt(∆x)**) - 51)

**∆x** = 105**n**/(102 - 6\*sqrt(289+2100\***Wt(∆x)**)) + 2^246

### Example

A simple example for constructing an output with a difficulty of 160000 (a miner on average has to go through 160000 hashes to find a solution) - all numbers are in hexadecimal.

Field order **n** = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141
Required work **Wt** = 0x27100
**∆x** = 0x00015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f3

Interval pairs (**x** values)

(x1a, x1b) = (0x0000000000000000000000000000000000000000000000000000000000000001, 0x00015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f4)
(x2a, x2b) = (0x0100000000000000000000000000000000000000000000000000000000000001, 0x01015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f4)
(x3a, x3b) = (0x0200000000000000000000000000000000000000000000000000000000000001, 0x02015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f4)
(x4a, x4b) = (0x0300000000000000000000000000000000000000000000000000000000000001, 0x03015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f4)
(x5a, x5b) = (0x0400000000000000000000000000000000000000000000000000000000000001, 0x04015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f4)
(x6a, x6b) = (0x0500000000000000000000000000000000000000000000000000000000000001, 0x05015f9a749d2e73e31754c8929cfc59f891019b2f8781ddeaecc430d59916f4)

Derive private key pairs from the **x** value pairs, **d**=-**x**/**r** mod **n**

(d1a, d1b) = (0x714c150e7cc990721378a2c2e5793c970352349ca849e07402b70a634efca6fd, 0xd7005728a9b90a68b9ea263c23eae65cf179843bac9aefe930a851780f1c1e32)
(d2a, d2b) = (0x55bbf0ee65ba65767b8ce233c711b1fcae7c097ac42a5977ba1876c7ce530395, 0xbb70330892a9df6d21fe65ad05835bc29ca35919c87b68ece809bddc8e727aca)
(d3a, d3b) = (0x3a2bccce4eab3a7ae3a121a4a8aa276259a5de58e00ad27b7179e32c4da9602d, 0x9fe00ee87b9ab4718a12a51de71bd12847cd2df7e45be1f09f6b2a410dc8d762)
(d4a, d4b) = (0x1e9ba8ae379c0f7f4bb561158a429cc804cfb336fbeb4b7f28db4f90ccffbcc5, 0x844feac8648b8975f226e48ec8b4468df2f702d6003c5af456cc96a58d1f33fa)
(d5a, d5b) = (0x030b848e208ce483b3c9a0866bdb122daff9881517cbc482e03cbbf54c56195d, 0x68bfc6a84d7c5e7a5a3b23ffaa4cbbf39e20d7b41c1cd3f80e2e030a0c759092)
(d6a, d6b) = (0xe77b606e097db9881bdddff74d73879215d239d9e2f4ddc2577086e69be2b736, 0x4d2fa288366d337ec24f63708be53159494aac9237fd4cfbc58f6f6e8bcbed2a)

Finally derive public keys from the private key pairs, **P**=**d**\*G, here the public keys are expressed in their compressed form.

(P1a, P1b) = (02f8f1e55f7349f7ab27c078a916ec02e055164fc7e69fc23e402fa9809acfd4f4, 03f90506c9d6bc07e3afe49e32e9706afd2f5d7ece6ae575d02ea8890ddb3063e6)
(P2a, P2b) = (037309a5ba25f35a9fac04bba70ff53fad7e571b204fae5b15823d2043536b874e, 02a1f2ad58db44ff014bc13ab0da22c3f81ac2c9669d1ff0b2c859787f192452f9)
(P3a, P3b) = (02df8c2213cd1e506a71188075614630380cefb5e1f4ae403ce43a0c55eb3666f3, 02db49be37690b7352fa3e15d67cd4acdeea20b871caa50370c3916948c3faa0c4)
(P4a, P4b) = (03a4dc09a46077c7f58be8a70a9bff31637b58a94ebbe85215449da0f647be90b0, 0397b292e2720f16b8ad94551d161b2b8fa38cd39de37cb55a77302275bbfe4b25)
(P5a, P5b) = (02dada669eeafb333374f467c3514f7b2dfcc57a67b659c2da4f989f53b4c71875, 02516c9a350512c50f6aa30efb6b8f47864df632a4a74c3f526ae8ad21fa0c128d)
(P6a, P6b) = (035df4a0bb365ba44df94e9bd2f343111e17d74e26afbe525e9c629c967a53da6f, 0332b3bf3c3037286c7e6658cbccdc819432956c087b446b4c5db7080db611b802)

Now we can create a locking script requiring that the signature sizes under all the public keys be of 59 bytes or less

```
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02f8f1e55f7349f7ab27c078a916ec02e055164fc7e69fc23e402fa9809acfd4f4 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 03f90506c9d6bc07e3afe49e32e9706afd2f5d7ece6ae575d02ea8890ddb3063e6 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 037309a5ba25f35a9fac04bba70ff53fad7e571b204fae5b15823d2043536b874e OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02a1f2ad58db44ff014bc13ab0da22c3f81ac2c9669d1ff0b2c859787f192452f9 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02df8c2213cd1e506a71188075614630380cefb5e1f4ae403ce43a0c55eb3666f3 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02db49be37690b7352fa3e15d67cd4acdeea20b871caa50370c3916948c3faa0c4 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 03a4dc09a46077c7f58be8a70a9bff31637b58a94ebbe85215449da0f647be90b0 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 0397b292e2720f16b8ad94551d161b2b8fa38cd39de37cb55a77302275bbfe4b25 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02dada669eeafb333374f467c3514f7b2dfcc57a67b659c2da4f989f53b4c71875 OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 02516c9a350512c50f6aa30efb6b8f47864df632a4a74c3f526ae8ad21fa0c128d OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 035df4a0bb365ba44df94e9bd2f343111e17d74e26afbe525e9c629c967a53da6f OP_CHECKSIGVERIFY
OP_SIZE 3c OP_LESSTHAN OP_VERIFY 0332b3bf3c3037286c7e6658cbccdc819432956c087b446b4c5db7080db611b802 OP_CHECKSIGVERIFY
```

A P2WSH address of the above script on mainnet results in: bc1q5jwt3crhwrkg4l7v3zwru32hdsug8j2407kdn3rx8ys5wyu24ljqlw4dz3

Finally we can create a transaction locking some amount of BTC to the bc1q5jwt3crhwrkg4l7v3zwru32hdsug8j2407kdn3rx8ys5wyu24ljqlw4dz3 address and we should also add an OP_RETURN output specifying the difficulty, such that the miner is able to re-construct the private keys & public keys.

Mainnet transactions:

1. PoW locked output initiated as output 0 of tx - [a9080e34c79ddec6fc430108cbea5f6a86dfc7fb6d04b7612cfd542548735229](https://mempool.space/tx/a9080e34c79ddec6fc430108cbea5f6a86dfc7fb6d04b7612cfd542548735229#vout=0)
2. Intermediate transation whose output was used as input 1 of the claim transaction - [bec2ec7e08d28b2e59ab9a66d9f054292c093f9c0f7b170265eb1c9834c42c6f](https://mempool.space/tx/bec2ec7e08d28b2e59ab9a66d9f054292c093f9c0f7b170265eb1c9834c42c6f)
3. Claim transaction - [2646b0f5633b45c5e2acb0eec639dea8da92d5d17a16fa9479ef988bede06d4a](https://mempool.space/tx/2646b0f5633b45c5e2acb0eec639dea8da92d5d17a16fa9479ef988bede06d4a)
