(BigInt.prototype as any).toJSON = function () {
    return this.toString()
}

import { Lucid, Emulator, fromHex, fromText, Data, toUnit } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { BwpExchangeMint, BwpExchangeSpend } from "./types.ts"


const _lucid = await Lucid.new(undefined, "Custom")
const seed = _lucid.utils.generateSeedPhrase()
const address = await _lucid.selectWalletFromSeed(seed).wallet.address()

const emulator = new Emulator([{
    address,
    assets: {
        lovelace: 20000000000n
    }
}])

const lucid = await Lucid.new(emulator, "Custom")
lucid.selectWalletFromSeed(seed)

const ownerVKH = lucid.utils.getAddressDetails(
    address
).paymentCredential!.hash


const bwpPolicy = lucid.utils.nativeScriptFromJson({
    type: "all",
    scripts: [
        {
            type: "sig",
            keyHash: ownerVKH
        }
    ]
})

const bwpAssetName = fromText("bushwifplanes")
const bwpPolicyId = lucid.utils.mintingPolicyToId(bwpPolicy)
const bwpFullAssetId = `${bwpPolicyId}${bwpAssetName}`

const admins = [ownerVKH]
const tiers = [91n, 911n, 911911n]
const RFTMintingPolicy = new BwpExchangeMint(bwpPolicyId, bwpAssetName, admins, tiers)

const RFTPolicyScriptHash = lucid.utils.validatorToScriptHash(RFTMintingPolicy)
const RFTPolicyContractAddress = lucid.utils.validatorToAddress(RFTMintingPolicy)

const description = "What do we put for the description...?"
const tier1Image = "ipfs://QmNrXv6eQakz74uPCqboy4hgb5RDjUzxM78GFERN7uoWTq"
const tier2Image = "ipfs://QmNrXv6eQakz74uPCqboy4hgb5RDjUzxM78GFERN7uoWTq"
const tier3Image = "ipfs://QmNrXv6eQakz74uPCqboy4hgb5RDjUzxM78GFERN7uoWTq"

const tier1Name = "BushWifPlanesTier1"
const tier2Name = "BushWifPlanesTier2"
const tier3Name = "BushWifPlanesTier3"


await mintBwp()
await mintReferenceTokens()
await mintActualTokens()
await spendReferenceToken()

async function mintBwp() {
    const mint = await lucid.newTx()
        .attachMintingPolicy(bwpPolicy)
        .mintAssets({
            [bwpFullAssetId]: 10000000000n
        })
        .complete()

    const signed = await mint.sign().complete()
    const txHash = await signed.submit()

    await lucid.awaitTx(txHash)
    console.log('minted bwp')
}

async function mintActualTokens() {
    const actualAssetNameTier1 = toUnit(RFTPolicyScriptHash, fromText("BushWifPlanesTier1"), 444)
    // const actualAssetNameTier2 = toUnit(RFTPolicyScriptHash, fromText("BushWifPlanesTier2"), 444)
    // const actualAssetNameTier3 = toUnit(RFTPolicyScriptHash, fromText("BushWifPlanesTier3"), 444)

    const mintRFTTx = await lucid.newTx()
        .attachMintingPolicy(RFTMintingPolicy)
        .mintAssets({
            [actualAssetNameTier1]: 1n,
        }, Data.to({ "MintBushWifPlanesRFT": [1n] }, BwpExchangeMint.redeemer)) // mint a tier 1
        .payToContract(RFTPolicyContractAddress, {
            inline: Data.void()
        }, {
            [bwpFullAssetId]: 91n
        })
        .complete()

    const signed = await mintRFTTx.sign().complete()
    const txHash = await signed.submit()

    await lucid.awaitTx(txHash)

    const walletUtxosAfter = await lucid.wallet.getUtxos()
    console.log("wallet Utxos after minting actual tokens")
    console.log(JSON.stringify(walletUtxosAfter, null, 2))
}

async function mintReferenceTokens() {
    const referenceAssetNameTier1 = toUnit(RFTPolicyScriptHash, fromText(tier1Name), 100)
    const referenceAssetNameTier2 = toUnit(RFTPolicyScriptHash, fromText(tier2Name), 100)
    const referenceAssetNameTier3 = toUnit(RFTPolicyScriptHash, fromText(tier3Name), 100)
    
    const mintRFTTx = await lucid.newTx()
        .attachMintingPolicy(RFTMintingPolicy)
        .mintAssets({
            [referenceAssetNameTier1]: 1n,
            [referenceAssetNameTier2]: 1n,
            [referenceAssetNameTier3]: 1n
        }, Data.to({ "MintReferenceTokens": [[1n, 2n, 3n]] }, BwpExchangeMint.redeemer))
        .payToContract(RFTPolicyContractAddress, {
            inline: Data.to({
                metadata: new Map([
                    [fromText("name"), fromText(tier1Name)],
                    [fromText("description"), fromText(description)],
                    [fromText("image"), fromText(tier1Image)],
                ]),
                version: 2n,
                extra: new Map([
                    [fromText("Tier"), fromText("1")]
                ])
            }, BwpExchangeSpend._cip68Datum)
        }, {
            [referenceAssetNameTier1]: 1n
        })
        .payToContract(RFTPolicyContractAddress, {
            inline: Data.to({
                metadata: new Map([
                    [fromText("name"), fromText(tier2Name)],
                    [fromText("description"), fromText(description)],
                    [fromText("image"), fromText(tier2Image)],
                ]),
                version: 2n,
                extra: new Map([
                    [fromText("Tier"), fromText("2")]
                ])
            }, BwpExchangeSpend._cip68Datum)
        }, {
            [referenceAssetNameTier2]: 1n
        })
        .payToContract(RFTPolicyContractAddress, {
            inline: Data.to({
                metadata: new Map([
                    [fromText("name"), fromText(tier3Name)],
                    [fromText("description"), fromText(description)],
                    [fromText("image"), fromText(tier3Image)],
                ]),
                version: 2n,
                extra: new Map([
                    [fromText("Tier"), fromText("3")]
                ])
            }, BwpExchangeSpend._cip68Datum)
        }, {
            [referenceAssetNameTier3]: 1n
        })
        .addSigner(address)
        .complete()

    // TODO: Maybe in the metadata put the params used to build the validator?

    const signed = await mintRFTTx.sign().complete()
    const txHash = await signed.submit()

    await lucid.awaitTx(txHash)

    const contractUtxosAfter = await lucid.utxosAt(RFTPolicyContractAddress)
    console.log("contract Utxos after minting reference tokens")
    console.log(JSON.stringify(contractUtxosAfter, null, 2))
}

async function spendReferenceToken() {
    const contractUtxos = await lucid.utxosAt(RFTPolicyContractAddress)
    const referenceAssetNameTier1 = toUnit(RFTPolicyScriptHash, fromText("BushWifPlanesTier1"), 100)

    const tier1RefAssetUtxo = contractUtxos.find(utxo => utxo.assets[referenceAssetNameTier1])
    if (!tier1RefAssetUtxo) {
        throw new Error("ref token doesnt exist on the contract lol")
    }

    const mint = await lucid.newTx()
    .collectFrom([tier1RefAssetUtxo], Data.to({wrapper: { wrapper: 1n }}, BwpExchangeSpend.redeemer))   // value in the wrappers is the "tier" parameterizing the redeemer
    .attachSpendingValidator(RFTMintingPolicy)  // god naming things is hard
    .payToContract(RFTPolicyContractAddress,{
        inline: Data.to({
            metadata: new Map([
                [fromText("name"), fromText(tier1Name)],
                [fromText("description"), fromText(description)],
                [fromText("image"), fromText(tier1Image)],
            ]),
            version: 2n,
            extra: new Map([
                [fromText("Tier"), fromText("1")]
            ])
        }, BwpExchangeSpend._cip68Datum)
    }, {
        [referenceAssetNameTier1]: 1n
    })
    .addSigner(address)
    .complete()

    const signed = await mint.sign().complete()
    const txHash = await signed.submit()

    await lucid.awaitTx(txHash)
}