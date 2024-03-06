(BigInt.prototype as any).toJSON = function () {
    return this.toString()
}

import { Blockfrost, Data, Lucid, fromText, toUnit } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { BwpExchangeMint, BwpExchangeSpend } from "./types.ts";

const seed = await Deno.readTextFile("./seed.txt")
const blockfrostKey = await Deno.readTextFile("./blockfrost.txt")

const lucid = await Lucid.new(
    new Blockfrost(
        "https://cardano-mainnet.blockfrost.io/api/v0",
        blockfrostKey
    )
)

lucid.selectWalletFromSeed(seed)

const BWP_POLICY = "5dc56fd1ce4335f8be2020f3f836cd11022dfbbf462e198a93e99126"
const BWP_ASSET_NAME = fromText("bushwifplanes")
const BWP_ASSET_ID = `${BWP_POLICY}${BWP_ASSET_NAME}`
const admins = ["ad1b43b5f71f8acbd70fe0cbdfeb39a3257cf9f0a649a3b068959832"]
const tierCosts = [2n, 3n, 4n]
const RFTMintingPolicy = new BwpExchangeMint(BWP_POLICY, BWP_ASSET_NAME, admins, tierCosts)

const RFTPolicyScriptHash = lucid.utils.validatorToScriptHash(RFTMintingPolicy)
const RFTPolicyContractAddress = lucid.utils.validatorToAddress(RFTMintingPolicy)

const description = "What do we put for the description...?"
const tier1Image = "ar://l2aIRhQByhK0zPODaiwzMYMXOphVhqPZNvyFnjotSws"
const tier2Image = "ipfs://QmNrXv6eQakz74uPCqboy4hgb5RDjUzxM78GFERN7uoWTq"
const tier3Image = "ipfs://QmNrXv6eQakz74uPCqboy4hgb5RDjUzxM78GFERN7uoWTq"

const tier1Name = "BushWifPlanesTier1"
const tier2Name = "BushWifPlanesTier2"
const tier3Name = "BushWifPlanesTier3"

await mintReferenceTokenTier1()

async function mintReferenceTokenTier1() {
    const referenceAssetNameTier1 = toUnit(RFTPolicyScriptHash, fromText(tier1Name), 100)

    const mintRFTTx = await lucid.newTx()
        .attachMintingPolicy(RFTMintingPolicy)
        .mintAssets({
            [referenceAssetNameTier1]: 1n,
        }, Data.to({ "MintReferenceTokens": [[1n]] }, BwpExchangeMint.redeemer))
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
        .addSigner(await lucid.wallet.address())
        .complete()

    const signed = await mintRFTTx.sign().complete()
    const txHash = await signed.submit()

    await lucid.awaitTx(txHash)

    const contractUtxosAfter = await lucid.utxosAt(RFTPolicyContractAddress)
    console.log("contract Utxos after minting reference tokens")
    console.log(JSON.stringify(contractUtxosAfter, null, 2))
}