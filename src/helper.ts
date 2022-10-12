import { Metadata } from '@metaplex-foundation/mpl-token-metadata';
import {
    AccountFetcher,
    collectFeesQuote,
    PDAUtil,
    PoolUtil,
    PositionData,
    PriceMath,
    TickArrayData,
    TickArrayUtil,
    TokenInfo,
    WhirlpoolClient,
    WhirlpoolContext
} from '@orca-so/whirlpools-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Address, BN } from '@project-serum/anchor';
import { DecimalUtil, TokenUtil } from '@orca-so/common-sdk';
import { Position, Whirlpool } from '@orca-so/whirlpools-sdk/dist/whirlpool-client';
import type { Coin } from './types/coin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const coins = require('./coins.json');

async function getFees(
    ctx: WhirlpoolContext,
    whirlpool: Whirlpool,
    position: Position,
    whirlpoolPublicKey: PublicKey,
    tokenA: TokenInfo,
    tokenB: TokenInfo
) {
    // Get TickArray and Tick
    const { tickSpacing } = whirlpool.getData();

    const tickArrayLowerPublicKey = PDAUtil.getTickArrayFromTickIndex(
        position.getData().tickLowerIndex,
        tickSpacing,
        whirlpoolPublicKey,
        ctx.program.programId
    ).publicKey;

    const tickArrayUpperPublicKey = PDAUtil.getTickArrayFromTickIndex(
        position.getData().tickUpperIndex,
        tickSpacing,
        whirlpoolPublicKey,
        ctx.program.programId
    ).publicKey;

    const tickArrayLower: TickArrayData | null = await ctx.fetcher.getTickArray(tickArrayLowerPublicKey);
    const tickArrayUpper: TickArrayData | null = await ctx.fetcher.getTickArray(tickArrayUpperPublicKey);

    if (!tickArrayLower || !tickArrayUpper) throw new Error('invalid tick array');

    const tickLower = TickArrayUtil.getTickFromArray(tickArrayLower, position.getData().tickLowerIndex, tickSpacing);
    const tickUpper = TickArrayUtil.getTickFromArray(tickArrayUpper, position.getData().tickUpperIndex, tickSpacing);

    const quoteFee = await collectFeesQuote({
        whirlpool: whirlpool.getData(),
        position: position.getData(),
        tickLower,
        tickUpper
    });

    return {
        tokenA: DecimalUtil.fromU64(quoteFee.feeOwedA, tokenA.decimals).toString(),
        tokenB: DecimalUtil.fromU64(quoteFee.feeOwedB, tokenB.decimals).toString()
    };
}

export async function getWhirlpoolPositionPublicKeys(
    ctx: WhirlpoolContext,
    fetcher: AccountFetcher,
    positionOwnerPublicKey: PublicKey
): Promise<PublicKey[]> {
    // Fetch all the token accounts owned by the specified account
    const tokenAccounts = (
        await ctx.connection.getTokenAccountsByOwner(positionOwnerPublicKey, { programId: TOKEN_PROGRAM_ID })
    ).value;

    const whirlpoolPositionPublicKeys: Address[] = tokenAccounts
        .map(tokenAccount => {
            const parsed = TokenUtil.deserializeTokenAccount(tokenAccount.account.data);
            if (parsed === null) throw new Error('invalid token account');

            const pda = PDAUtil.getPosition(ctx.program.programId, parsed.mint);

            return new BN(1).eq(parsed.amount as BN) ? pda.publicKey : undefined;
        })
        .filter((publicKey: PublicKey | undefined) => publicKey !== undefined) as Address[];

    // Retrieve a list of cached position accounts
    const accountPositions: Array<PositionData | null> = await fetcher.listPositions(whirlpoolPositionPublicKeys, true);
    if (!accountPositions.length) throw new Error('No position found');

    return whirlpoolPositionPublicKeys.filter((_: Address, i) => {
        const position: PositionData | null = accountPositions[i];
        return position !== null;
    }) as PublicKey[];
}

export async function getPositionData(
    ctx: WhirlpoolContext,
    positionAddress: Address,
    client: WhirlpoolClient,
    connection: Connection
) {
    const position: Position = await client.getPosition(positionAddress);

    const whirlpoolPublicKey: PublicKey = position.getData().whirlpool;
    const whirlpool: Whirlpool = await client.getPool(whirlpoolPublicKey);

    const data = position.getData();
    const tokenA: TokenInfo = whirlpool.getTokenAInfo();
    const tokenB: TokenInfo = whirlpool.getTokenBInfo();
    const lowerPrice = PriceMath.tickIndexToPrice(data.tickLowerIndex, tokenA.decimals, tokenB.decimals);
    const upperPrice = PriceMath.tickIndexToPrice(data.tickUpperIndex, tokenA.decimals, tokenB.decimals);

    const amounts = PoolUtil.getTokenAmountsFromLiquidity(
        data.liquidity,
        whirlpool.getData().sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(data.tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(data.tickUpperIndex),
        true
    );

    const mintPublicKeyA = new PublicKey(whirlpool.getTokenAInfo().mint.toBase58());
    const mintPublicKeyB = new PublicKey(whirlpool.getTokenBInfo().mint.toBase58());
    const tokenAMetaPublicKey = await Metadata.getPDA(mintPublicKeyA);
    const tokenBMetaPublicKey = await Metadata.getPDA(mintPublicKeyB);
    const tokenAMeta = await Metadata.load(connection, tokenAMetaPublicKey);
    const tokenBMeta = await Metadata.load(connection, tokenBMetaPublicKey);

    const fees = await getFees(ctx, whirlpool, position, whirlpoolPublicKey, tokenA, tokenB);

    const sqrtPriceX64 = whirlpool.getData().sqrtPrice;
    const price = PriceMath.sqrtPriceX64ToPrice(sqrtPriceX64, tokenA.decimals, tokenB.decimals);

    const tokenACoin: Coin | undefined = coins.find(
        (coin: Coin) => coin.symbol.toLowerCase() === tokenAMeta.data.data.symbol.toLowerCase()
    );
    const tokenBCoin: Coin | undefined = coins.find(
        (coin: Coin) => coin.symbol.toLowerCase() === tokenBMeta.data.data.symbol.toLowerCase()
    );

    if (!tokenACoin || !tokenBCoin) throw new Error('Invalid coin');

    const requestParams = new URLSearchParams({
        ids: `${tokenACoin.id},${tokenBCoin.id}`,
        vs_currencies: 'usd'
    });

    const tokenPrice: any = await axios
        .get(`https://api.coingecko.com/api/v3/simple/price?${requestParams}`)
        .then((response: any) => response.data);

    const balanceA =
        parseFloat(DecimalUtil.fromU64(amounts.tokenA, tokenA.decimals).toString()) * tokenPrice[tokenACoin.id].usd;
    const balanceB =
        parseFloat(DecimalUtil.fromU64(amounts.tokenB, tokenB.decimals).toString()) * tokenPrice[tokenBCoin.id].usd;

    const rewardsA = parseFloat(fees.tokenA) * tokenPrice[tokenACoin.id].usd;
    const rewardsB = parseFloat(fees.tokenB) * tokenPrice[tokenBCoin.id].usd;

    return {
        positionAddress: data.positionMint.toBase58(),
        lower: lowerPrice.toFixed(tokenB.decimals),
        upper: upperPrice.toFixed(tokenB.decimals),
        price: parseFloat(price.toString()),
        inRange: price.gt(lowerPrice) && price.lte(upperPrice),
        balance: (balanceA + balanceB).toFixed(2),
        rewards: (rewardsA + rewardsB).toFixed(2),
        tokenA: {
            address: tokenA.mint.toBase58(),
            usdPrice: tokenPrice[tokenACoin.id].usd,
            name: tokenAMeta.data.data.name,
            symbol: tokenAMeta.data.data.symbol,
            amount: parseFloat(DecimalUtil.fromU64(amounts.tokenA, tokenA.decimals).toString()),
            fees: parseFloat(fees.tokenA),
        },
        tokenB: {
            address: tokenB.mint.toBase58(),
            usdPrice: tokenPrice[tokenBCoin.id].usd,
            name: tokenBMeta.data.data.name,
            symbol: tokenBMeta.data.data.symbol,
            amount: parseFloat(DecimalUtil.fromU64(amounts.tokenB, tokenB.decimals).toString()),
            fees: parseFloat(fees.tokenB),
        }
    };
}
