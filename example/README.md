# PoW-locked output utilities

The core of the algorithm is in the pow-script.js file, you can also find a more optimized version in the cached-grinding directory (this uses caching to skip some hash computations).

## Generating PoW-locked address

You can generate the PoW-locked address for a specific amount of work (that means how many hashes does a miner have to go through on average) by using gen-address.js

```
node gen-address.js <work> <network: mainnet, testnet>
```

Example:

```
node gen-address.js 262144 testnet
```

generates PoW-locked address for testnet (works on both testnet3 & testnet4)

## Mining (grinding) a PoW-locked output

You can start mining/grinding a PoW-locked output using grind.js

```
Usage: node grind.js <work> <network: mainnet, testnet3, testnet4> <pow-locked UTXO in format txId:vout> <intermediate UTXO in format txId:vout> <fee rate sats/vB> <recipient address>
```

You need to provide work (same as specified when creating the address - this will run a sanity check and throw an error if work doesn't match), UTXO of PoW-locked output, intermediate UTXO from a wallet you control to be used for intermediate transaction (and grinding SIGHASH_NONE), fee rate in sats/vB to use & finally an address where you want to receive the reward.

Example:
```
node grind.js 262144 testnet4 893d132165c262d47e9bca54b18f6264531858e9bc7b0c2b1efac14ad234d0b9:0 63e0fcd8c7a828dc979da397fa82fdd7d8e49b9d5a693273fbd98813f254299c:0 1 tb1qtummmndl4j3kal5pn27wh6mxwnzq8n42zps6fc
```

This script generates 3 files upon completion in the "transactions" directory:
1. psbt.txt - base64 encoded psbt to be signed by your wallet (this is the intermediate transaction used for grinding SIGHASH_NONE)
2. claimTx.txt - hex encoded transaction claiming the funds from the PoW-locked output (this sends the funds to a generated P2WSH address that was used to grind SIGHASH_SINGLE)
3. spendTx.txt - hex encoded transaction spending the claimed funds to the final recipient

You can then take the psbt.txt, sign it & broadcast it in your wallet. Then broadcast the transation from claimTx.txt, and finally broadcast the spendTx.txt transaction.
