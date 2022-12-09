import { BigNumber, Contract, ethers, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { gql, request } from 'graphql-request';
import moment from 'moment';

import { multicallABI, newoDistributorABI, uniswapV3Interface, veNEWOInterface } from './abis';
import { ChainId, CONTRACTS_ADDRESSES } from './globals';
import { httpProvider } from './provider';
import { getAmountsForLiquidity } from './uniswap';
import { BN2Number } from './utils';

async function fetchPositionsAndSwaps(pool: string, week: number, chainId: number, first: number) {
  console.log('Fetching positions and swaps...');
  console.log('-----');

  // const tg_uniswap = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'; // mainnet
  const tg_uniswap = 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-gorli'; // testnet

  // prod vs testnet query, testnet uses amount of stables in swap (amount0 is USDC) instead of amountUSD
  const swapQuery =
    process.env.PRODUCTION_SETUP === 'true'
      ? gql`
          query getSwaps($pool: String!, $uTimestamp: Int!, $lTimestamp: Int!, $first: Int!) {
            swaps(
              where: { pool: $pool, timestamp_gt: $lTimestamp, timestamp_lt: $uTimestamp, amountUSD_gt: 50 }
              orderBy: amountUSD
              orderDirection: desc
              first: $first
            ) {
              timestamp
              amountUSD
              tick
              sqrtPriceX96
              transaction {
                blockNumber
              }
            }
          }
        `
      : gql`
          query getSwaps($pool: String!, $uTimestamp: Int!, $lTimestamp: Int!, $first: Int!) {
            swaps(where: { pool: $pool, timestamp_gt: $lTimestamp, timestamp_lt: $uTimestamp }, orderDirection: desc, first: $first) {
              timestamp
              amountUSD: amount0
              tick
              sqrtPriceX96
              transaction {
                blockNumber
              }
            }
          }
        `;

  // make swap request
  const data = await request<{
    swaps: {
      amountUSD: string;
      tick: string;
      sqrtPriceX96: string;
      timestamp: string;
      transaction: { blockNumber: string };
    }[];
  }>(tg_uniswap as string, swapQuery, {
    lTimestamp: week * (7 * 24 * 3600),
    pool: pool,
    // uTimestamp: week * (7 * 24 * 3600) + 7 * 24 * 3600,
    uTimestamp: 1670306100,
    first,
  });

  console.log('lTimestamp: ', week * (7 * 24 * 3600));
  console.log('uTimestamp: ', week * (7 * 24 * 3600) + 7 * 24 * 3600);
  console.log('-----');

  const swaps = data.swaps.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

  let skip = 0;
  let isFullyFetched = false;
  let positions: string[] = [];

  while (!isFullyFetched) {
    const positionQuery = gql`
      query getPositions($pool: String!, $skip: Int!) {
        positionSnapshots(where: { pool_: { id: $pool } }, first: 1000, skip: $skip) {
          position {
            id
          }
        }
      }
    `;

    // make positions request
    const data = await request<{
      positionSnapshots: { position: { id: string } }[];
    }>(tg_uniswap as string, positionQuery, {
      pool: pool,
      skip,
    });

    const fetchedPositions = data?.positionSnapshots?.map((e) => e?.position.id);
    if (fetchedPositions.length < 1000) {
      isFullyFetched = true;
    } else {
      skip += 1000;
    }
    positions = positions.concat(fetchedPositions);
  }

  return { positions, swaps };
}

// ================================= PARAMETERS ================================

interface uniswapIncentiveParameters {
  name: string;
  weights: { fees: number; token0: number; token1: number };
  uniswapV3poolAddress: string;
  NEWO: string;
}

// =================================== LOGIC ===================================
// returns rewards
export async function computeUniswapV3Incentives(chainId: number, params: uniswapIncentiveParameters, first: number) {
  console.log('Computing Uniswap v3 incentives...');
  console.log('-----');

  const provider = httpProvider(chainId); // ethers.provider
  const multicallAddress = CONTRACTS_ADDRESSES.MulticallWithFailure as string;

  // *** time
  const weekInPast = 1;
  const week = Math.floor(moment().unix() / (7 * 24 * 3600)) - weekInPast;
  const secondsInWeek = 7 * 24 * 3600;

  // Fetch weekly rewards
  // equal to Angle's https://etherscan.io/address/0x4f91F01cE8ec07c9B1f6a82c18811848254917Ab#readProxyContract
  const newoDistributor = new Contract(CONTRACTS_ADDRESSES.NewoDistributor as string, newoDistributorABI, provider) as any;

  // uses https://etherscan.io/address/0x9aD7e7b0877582E14c17702EecF49018DD6f2367#readContract
  // const gaugeWeight = await gaugeController['gauge_relative_weight(address,uint256)'](params.gaugeAddress, week * secondsInWeek);
  // const rewardRate = process.env.PRODUCTION_SETUP === 'true' ? await newoDistributor.rewardRate() : '218553396329365079';
  // const reductionRate = process.env.PRODUCTION_SETUP === 'true' ? await newoDistributor.rewardsDuration() : '604800';
  // const elapsedWeeks = -weekInPast; // Compute rewards for last week, is * -1

  // let weeklyRewards = BigNumber.from(rewardRate).mul(secondsInWeek);
  // for (let i = 1; i <= elapsedWeeks; i++) {
  //   weeklyRewards = weeklyRewards.mul(parseEther('1')).div(reductionRate);
  // }
  // if (elapsedWeeks < 0) {
  //   for (let i = 1; i <= -elapsedWeeks; i++) {
  //     weeklyRewards = weeklyRewards.mul(reductionRate).div(parseEther('1'));
  //   }
  // }
  const weeklyRewards = '100000000000000000000'; // amont to be distributed this week

  // data object that we'll fill
  const data: { [holder: string]: { fees: number; token0: number; token1: number } } = {};

  // pull all the data
  if (!!params.NEWO && !!multicallAddress) {
    // Uses a custom multicall contract that accept reverts
    const multicall = new Contract(multicallAddress, multicallABI, provider);

    try {
      // Fetch Uniswap V3 positions and swaps
      const { positions, swaps } = await fetchPositionsAndSwaps(params.uniswapV3poolAddress?.toLowerCase(), week, chainId, first);
      console.log('Positions: ', positions);
      console.log('Swaps: ', swaps);

      // pull the amountUSD of each swap, different for testnet
      let totalAmountUSD = 0; // is in regular dollar amount
      swaps.forEach((s) => (totalAmountUSD += parseInt(s.amountUSD)));
      console.log('totalAmountUSD value of weekly swaps combined: ', totalAmountUSD);
      console.log('-----');

      // *** loop through each swap of the week
      console.log('Looping through ', swaps.length, ' swaps of the week');
      let index = 0;
      for (const swap of swaps) {
        // create empty tempData object
        const tempData: { [holder: string]: { fees: number; token0: number; token1: number } } = {};

        // do on chain calls and retrieve the liquidity providers / swaptoken amounts and fees
        try {
          // ============================== UNISWAP V3 NFTS ==============================
          let calls = [];

          // create calls for each liquidity position using the returned id's from subgraph
          for (const id of positions) {
            calls.push({
              canFail: true,
              data: uniswapV3Interface.encodeFunctionData('positions', [BigNumber.from(id)]),
              target: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // uniswap same for all networks
            });
            calls.push({
              canFail: true,
              data: uniswapV3Interface.encodeFunctionData('ownerOf', [BigNumber.from(id)]),
              target: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // uniswap same for all networks
            });
          }

          // execute the calls onchain
          const fetchedData = multicall.interface.decodeFunctionResult(
            'multiCall',
            await provider.call(
              { data: multicall.interface.encodeFunctionData('multiCall', [calls]), to: multicall.address },
              parseInt(swap.transaction.blockNumber)
            )
          )[0];

          // compute liquidity and fees for every existing liquidity provider
          let j = 0;
          for (const id of positions) {
            try {
              const posLiquidity = uniswapV3Interface.decodeFunctionResult('positions', fetchedData[j]).liquidity;
              const lowerTick = parseFloat(uniswapV3Interface.decodeFunctionResult('positions', fetchedData[j]).tickLower.toString());
              const upperTick = parseFloat(uniswapV3Interface.decodeFunctionResult('positions', fetchedData[j++]).tickUpper.toString());
              const owner = uniswapV3Interface.decodeFunctionResult('ownerOf', fetchedData[j++])[0];

              // check the position for what prices it's liquidity was active
              const [amount0, amount1] = getAmountsForLiquidity(parseFloat(swap.tick), lowerTick, upperTick, posLiquidity);

              if (lowerTick < parseFloat(swap.tick) && parseFloat(swap.tick) < upperTick) {
                // create empty tempData object
                if (!tempData[owner]) tempData[owner] = { fees: 0, token0: 0, token1: 0 };

                tempData[owner].fees += parseFloat(swap.amountUSD) * BN2Number(posLiquidity);
                tempData[owner].token0 += (BN2Number(amount0) * parseInt(swap.amountUSD)) / totalAmountUSD;
                tempData[owner].token1 += (BN2Number(amount1) * parseInt(swap.amountUSD)) / totalAmountUSD;
              }
            } catch {
              // todo why skip ahead 2 positions if one fails
              j += 2;
            }
          }

          // calculate rewards owed from newo bal, usdc bal, and fees earned in the position and pool, with veNEWO boost
          let totalToken0 = 0;
          let totalToken1 = 0;
          let totalFees = 0;
          Object.values(tempData).forEach((p) => {
            totalToken0 += p.token0;
            totalToken1 += p.token1;
            totalFees += p.fees;
          });

          calls = [];
          j = 0;

          // create calls for veNEWO multipliers
          for (const h of Object.keys(tempData)) {
            calls.push({
              canFail: true,
              data: veNEWOInterface.encodeFunctionData('veMult', [h]),
              target: CONTRACTS_ADDRESSES.veNEWO,
            });
          }

          // execute the veNEWO multiplier calls
          const fetchedVeNewoData = multicall.interface.decodeFunctionResult(
            'multiCall',
            await provider.call(
              { data: multicall.interface.encodeFunctionData('multiCall', [calls]), to: multicallAddress },
              parseInt(swap.transaction.blockNumber)
            )
          )[0];

          // ============================== VENEWO BOOSTING =============================
          for (const holder of Object.keys(tempData)) {
            const veMult = veNEWOInterface.decodeFunctionResult('veMult', fetchedVeNewoData[j++])[0];

            // give multiplier to fees, token0 and token1
            if (veMult.toString() != '0') {
              console.log('veMult: ', veMult.toString());
              tempData[holder].fees *= veMult;
              tempData[holder].token0 *= veMult;
              tempData[holder].token1 *= veMult;
            }
          }

          // Add the new temp data to the global data object
          Object.keys(tempData).forEach((h) => {
            if (!data[utils.getAddress(h)]) data[utils.getAddress(h)] = { fees: 0, token0: 0, token1: 0 };

            data[utils.getAddress(h)].fees += tempData[h].fees;
            data[utils.getAddress(h)].token0 += tempData[h].token0;
            data[utils.getAddress(h)].token1 += tempData[h].token1;
          });

          // increase index by 1 for the loop
          index = index + 1;
          console.log(`===== ${params.name} ${((index * 100) / swaps.length).toFixed(2)} % =====`);
        } catch (e) {
          console.log(e);
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  console.log('-----');

  // for every holder returned in data, add up their holdings to a total amount
  let totalToken0 = 0;
  let totalToken1 = 0;
  let totalFees = 0;
  Object.values(data).forEach((p) => {
    totalToken0 += p.token0;
    totalToken1 += p.token1;
    totalFees += p.fees;
  });

  // console.log('Total token0: ', totalToken0);
  // console.log('Total token1: ', totalToken1);
  // console.log('Total fees: ', totalFees); // todo why does this print so ugly
  console.log('weeklyRewards: ', ethers.utils.formatEther(weeklyRewards), ' NEWO');
  console.log('-----');

  // rewards object that we fill
  const rewards: { [holder: string]: number } = {};

  // calculate rewards per holder using the rewards equation
  for (const holder of Object.keys(data)) {
    // rewards equation
    const ratio =
      (params.weights.fees * data[holder].fees) / totalFees +
      (params.weights.token0 * data[holder].token0) / totalToken0 +
      (params.weights.token1 * data[holder].token1) / totalToken1;

    // save rewards to holder
    rewards[holder] = !!rewards[holder] ? rewards[holder] : 0 + BN2Number(weeklyRewards) * ratio;

    // log the rewards owed in console for easy viewing
    console.log(holder, ' gets ', rewards[holder], ' NEWO');
  }

  return rewards;
}
