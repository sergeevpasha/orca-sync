import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Wallet } from '@project-serum/anchor';
import {
    AccountFetcher,
    buildWhirlpoolClient,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    WhirlpoolContext
} from '@orca-so/whirlpools-sdk';
import { getPositionData, getWhirlpoolPositionPublicKeys } from './helper';
import type { Response } from './types/response';

export const handler = async (event: any): Promise<Response> => {
    if (!event.queryStringParameters) throw new Error('Invalid request');
    if (!event.queryStringParameters.account) throw new Error('Missing account address');

    // Connect To RPC
    const connection = new Connection('https://try-rpc.mainnet.solana.blockdaemon.tech', 'singleGossip');
    const wallet = new Wallet(Keypair.generate());
    const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
    const fetcher = new AccountFetcher(ctx.connection);
    const client = buildWhirlpoolClient(ctx);

    const positions = await getWhirlpoolPositionPublicKeys(
        ctx,
        fetcher,
        new PublicKey(event.queryStringParameters.account)
    );

    const results = await Promise.all(
        positions.map(async position => {
            return getPositionData(ctx, position, client, connection);
        })
    );

    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(results.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance)))
    };
};
