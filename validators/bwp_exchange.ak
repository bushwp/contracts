use aiken/transaction.{ScriptContext, Transaction, Mint, Spend, InlineDatum, find_input}
use aiken/list
use aiken/transaction/value
use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction/credential.{ScriptCredential, VerificationKey}
use aiken/bytearray
use aiken/string
use aiken/cbor

const asset_name: ByteArray = #"42757368576966506c616e657354696572" // BushWifPlanesTier - we'll put a tier number on it later
const reference_token_prefix: ByteArray = #"000643b0" // (100)
const rich_ft_prefix: ByteArray = #"001bc280" // (444)

type CIP68Datum {
  metadata: Dict<Data, Data>,
  version: Int,
  extra: Data
}

type MintTypeSelectionRedeemer {
    MintReferenceTokens(List<Int>)
    MintBushWifPlanesRFT(Int)
}

type SpendTypeSelectionRedeemer {
    UpdateReferenceToken(Int)
}

type VerificationKeyHash =
  Hash<Blake2b_224, VerificationKey>

validator(bwp_policy: ByteArray, bwp_asset_name: ByteArray, administrator_keys: List<VerificationKeyHash>, tier_segments: List<Int>) {
    fn spend(_cip68_datum: CIP68Datum, redeemer: SpendTypeSelectionRedeemer, ctx: ScriptContext) {
        expect UpdateReferenceToken(tier) = redeemer 

        let ScriptContext { transaction, purpose } = ctx
        expect Spend(spent_utxo_ref) = purpose

        let Transaction { inputs, outputs, extra_signatories, .. } = transaction
        expect Some(ref_input) = inputs |> find_input(spent_utxo_ref)

        let own_address = ref_input.output.address

        expect ScriptCredential(own_policy) = own_address.payment_credential

        let base_reference_asset_name = bytearray.concat(reference_token_prefix, asset_name) 
        let tiered_reference_asset_name = base_reference_asset_name 
            |> bytearray.concat(string.to_bytearray(string.from_int(tier)))
        
        // find the reference token in the outputs and verify its returning it to this contract
        expect Some(ref_token_output) = list.find(outputs, fn (output) {
            value.quantity_of(output.value, own_policy, tiered_reference_asset_name) == 1
        })
        expect ref_token_output.address == own_address

        // Disallow spending any other tokens from this policy
        let num_policy_tokens_in_this_input = ref_input.output.value
            |> value.tokens(own_policy)
            |> dict.size()
        expect num_policy_tokens_in_this_input == 1

        // verify the datum is present at the new ref tokenoutput
        expect InlineDatum(ref_token_output_datum) = ref_token_output.datum
        // validate the datum structure
        expect _: CIP68Datum = ref_token_output_datum

        // signed by the owner wallet
        expect list.any(extra_signatories, fn(signer) {
            list.has(administrator_keys, signer)
        })

        True
    }

    fn mint(redeemer: MintTypeSelectionRedeemer, ctx: ScriptContext) {
        let ScriptContext { transaction, purpose } = ctx

        expect Mint(own_policy) = purpose
        
        when redeemer is {
            MintReferenceTokens(tiers) -> {
                // mint the reference NFTs that hold our metadata for the actual RFTs
                mint_reference_tokens(administrator_keys, own_policy, transaction, tiers, tier_segments)
            }
            MintBushWifPlanesRFT(tier) -> {
                // mint an actual rich fungible token
                mint_actual_token(own_policy, bwp_policy, bwp_asset_name, transaction, tier, tier_segments)
            }
        }
    }
}

fn mint_reference_tokens(administrator_keys: List<VerificationKeyHash>, own_policy: ByteArray, transaction: Transaction, requested_tiers: List<Int>, tier_segments: List<Int>) -> Bool {
    let Transaction { outputs, mint, extra_signatories, .. } = transaction

    let base_reference_asset_name = bytearray.concat(reference_token_prefix, asset_name) 

    let base_actual_asset_name = bytearray.concat(rich_ft_prefix, asset_name)

    let num_tiers = list.length(tier_segments)

    // mints for the same policy validate all at once, so we handle all the tiers in one go here...
    expect list.all(requested_tiers, fn (tier) {
        // can't have tier "4" if there are only 3 tier segments
        expect tier <= num_tiers

        // e.g. (100)BushWifPlanesTier1
        let tiered_reference_asset_name = base_reference_asset_name 
            |> bytearray.concat(string.to_bytearray(string.from_int(tier)))

        // for every tier in the redeemer, we mint exactly 1 reference token of that tier
        // notably this does not prevent minting duplicate reference tokens. 
        // TODO: maybe we should allow for burning reference tokens?
        expect 1 = mint
            |> value.from_minted_value
            |> value.quantity_of(own_policy, tiered_reference_asset_name)
        
        // how many kinds of tokens from this policy did we mint?
        let num_policy_token_kind_minted = mint
            |> value.from_minted_value
            |> value.tokens(own_policy)
            |> dict.size()

        // verify we only minted the number of kinds of tokens we expected based on the tiers redeemer
        expect num_policy_token_kind_minted == list.length(requested_tiers)

        // find and validate the output with the minted reference token
        expect Some(ref_token_output) = list.find(outputs, 
            fn(output) {
                // is this output the one with the ref token?
                let has_ref_token = value.quantity_of(output.value, own_policy, tiered_reference_asset_name) == 1

                // the token must be sent back to this policy's own contract address
                let is_to_this_script = when output.address.payment_credential is {
                    ScriptCredential(script_credential) -> {
                        script_credential == own_policy
                    }
                    _ -> False
                } 

                has_ref_token && is_to_this_script
            }
        )

        expect InlineDatum(ref_token_output_datum) = ref_token_output.datum
        // validate the datum structure at the ref token utxo
        expect _: CIP68Datum = ref_token_output_datum

        True
    })

    // signed by an administrator
    expect list.any(extra_signatories, fn(signer) {
        list.has(administrator_keys, signer)
    })

    True
}

fn mint_actual_token(own_policy: ByteArray, bwp_policy: ByteArray, bwp_asset_name: ByteArray, transaction: Transaction, tier: Int, tier_segments: List<Int>) -> Bool {
    let Transaction { outputs, mint, .. } = transaction
    // must be minting exactly one token
    // must be spending exaxctly the right amount of bwp for the tier

    let num_tiers = list.length(tier_segments)

    // can't have a tier that doesn't exist
    expect tier <= num_tiers

    // e.g. (444)BushWifPlanesTier
    let base_actual_asset_name = bytearray.concat(rich_ft_prefix, asset_name)

    // e.g. (444)BushWifPlanesTier1
    let tiered_actual_asset_name = base_actual_asset_name 
        |> bytearray.concat(string.to_bytearray(string.from_int(tier)))

    // minting exactly one of the tiered asset
    expect 1 = mint
        |> value.from_minted_value
        |> value.quantity_of(own_policy, tiered_actual_asset_name)
    
    // not trying to mint any other tokens from this policy!!
    expect 1 = mint
        |> value.from_minted_value
        |> value.tokens(own_policy)
        |> dict.size()

    // tier_segments are [Tier1Cost, Tier2Cost, Tier3Cost]
    expect Some(cost_amount) = list.at(tier_segments, tier - 1)

    // must be sending the correct amount to THIS CONTRACT
    expect Some(_) = list.find(outputs, 
        fn(output) {
            // the payment must be sent to this contract (and thus burned)
            let is_to_this_script = when output.address.payment_credential is {
                ScriptCredential(script_credential) -> {
                    script_credential == own_policy
                }
                _ -> False
            }

            let is_correct_payment = cost_amount == value.quantity_of(output.value, bwp_policy, bwp_asset_name)

            is_correct_payment && is_to_this_script
        }
    )

    True
}