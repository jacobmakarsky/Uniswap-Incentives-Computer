import { BigNumber, Contract, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { gql, request } from 'graphql-request';
import moment from 'moment';

import { multicallABI, NewoDistributor__factory, uniswapV3Interface, veNEWOInterface } from './abis';
import { ChainId, CONTRACTS_ADDRESSES } from './globals';
import { httpProvider } from './provider';
import { getAmountsForLiquidity } from './uniswap';
import { BN2Number } from './utils';

async function fetchPositionsAndSwaps(pool: string, week: number, chainId: number, first: number) {
  console.log('Fetching positions and swaps...');

  // const tg_uniswap = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'; // mainnet
  const tg_uniswap = 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-gorli'; // testnet

  // todo amountUSD removed for testnet since its a custom USDC and doesnt register as USD amount
  const swapQuery = gql`
    query getSwaps($pool: String!, $uTimestamp: Int!, $lTimestamp: Int!, $first: Int!) {
      swaps(where: { pool: $pool, timestamp_gt: $lTimestamp, timestamp_lt: $uTimestamp }, orderDirection: desc, first: $first) {
        timestamp
        tick
        sqrtPriceX96
        transaction {
          blockNumber
        }
      }
    }
  `; // testnet

  // const swapQuery = gql`
  //   query getSwaps($pool: String!, $uTimestamp: Int!, $lTimestamp: Int!, $first: Int!) {
  //     swaps(
  //       where: { pool: $pool, timestamp_gt: $lTimestamp, timestamp_lt: $uTimestamp, amountUSD_gt: 50 }
  //       orderBy: amountUSD
  //       orderDirection: desc
  //       first: $first
  //     ) {
  //       timestamp
  //       amountUSD
  //       tick
  //       sqrtPriceX96
  //       transaction {
  //         blockNumber
  //       }
  //     }
  //   }
  // `;

  // make the request
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
    uTimestamp: week * (7 * 24 * 3600) + 7 * 24 * 3600,
    // uTimestamp: 1668101837,
    first,
  });
  console.log('Swaps query: ', data);

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

    const data = await request<{
      positionSnapshots: { position: { id: string } }[];
    }>(tg_uniswap as string, positionQuery, {
      pool: pool,
      skip,
    });
    console.log('Positions call: ', data);

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
  console.log('Computing uniswap v3 incentives...');

  const provider = httpProvider(chainId); // ethers.provider
  // const mainnetProvider = httpProvider(ChainId.MAINNET); // ethers.provider
  const multicallAddress = CONTRACTS_ADDRESSES.MulticallWithFailure as string;
  // const mainnetMulticallAddress = CONTRACTS_ADDRESSES.MulticallWithFailure as string;
  const weekInPast = 1;
  const week = Math.floor(moment().unix() / (7 * 24 * 3600)) - weekInPast;
  const secondsInWeek = 7 * 24 * 3600;

  // Fetch weekly rewards
  // const newoDistributor = new Contract(
  //   CONTRACTS_ADDRESSES.NewoDistributor as string,
  //   NewoDistributor__factory, // abi file
  //   mainnetProvider
  // );

  const rewardRate = '2582511300060684750'; // taken from angleDistributor contract
  const reductionRate = '1007827884862117171'; // taken from angleDistributor contract
  const elapsedWeeks = -weekInPast; // Compute rewards for last week

  let weeklyRewards = BigNumber.from(rewardRate).mul(secondsInWeek);
  for (let i = 1; i <= elapsedWeeks; i++) {
    weeklyRewards = weeklyRewards.mul(parseEther('1')).div(reductionRate);
  }
  if (elapsedWeeks < 0) {
    for (let i = 1; i <= -elapsedWeeks; i++) {
      weeklyRewards = weeklyRewards.mul(reductionRate).div(parseEther('1'));
    }
  }
  weeklyRewards = weeklyRewards.div(parseEther('1')); // TODO: might need to remove this line since gauge was removed

  // Data object that we'll fill
  const data: { [holder: string]: { fees: number; token0: number; token1: number } } = {};
  if (!!params.NEWO && !!multicallAddress) {
    // Uses a custom multicall contract that accept reverts
    const multicall = new Contract(multicallAddress, multicallABI, provider);

    try {
      // Fetch Uniswap V3 positions and swaps
      const { positions, swaps } = await fetchPositionsAndSwaps(params.uniswapV3poolAddress?.toLowerCase(), week, chainId, first);
      console.log('Fetched positions: ', positions);
      console.log('Fetched swaps: ', swaps);
      let totalAmountUSD = 0;
      swaps.forEach((s) => (totalAmountUSD += parseInt(s.amountUSD)));

      // Loop through each swap of the week
      let index = 0;
      for (const swap of swaps) {
        const tempData: { [holder: string]: { fees: number; token0: number; token1: number } } = {};

        try {
          // ============================== UNISWAP V3 NFTS ==============================

          const calls = []; // todo changed from let since gets reassigned
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

          // Launch the multicall with possible failure
          const fetchedData = multicall.interface.decodeFunctionResult(
            'multiCall',
            await provider.call(
              { data: multicall.interface.encodeFunctionData('multiCall', [calls]), to: multicall.address },
              parseInt(swap.transaction.blockNumber)
            )
          )[0];

          let j = 0;
          // Compute liquidity and fees
          for (const id of positions) {
            try {
              const posLiquidity = uniswapV3Interface.decodeFunctionResult('positions', fetchedData[j]).liquidity;
              const lowerTick = parseFloat(uniswapV3Interface.decodeFunctionResult('positions', fetchedData[j]).tickLower.toString());
              const upperTick = parseFloat(uniswapV3Interface.decodeFunctionResult('positions', fetchedData[j++]).tickUpper.toString());
              const owner = uniswapV3Interface.decodeFunctionResult('ownerOf', fetchedData[j++])[0];
              const [amount0, amount1] = getAmountsForLiquidity(parseFloat(swap.tick), lowerTick, upperTick, posLiquidity);

              if (lowerTick < parseFloat(swap.tick) && parseFloat(swap.tick) < upperTick) {
                if (!tempData[owner]) tempData[owner] = { fees: 0, token0: 0, token1: 0 };
                tempData[owner].fees += parseFloat(swap.amountUSD) * BN2Number(posLiquidity);
                tempData[owner].token0 += (BN2Number(amount0) * parseInt(swap.amountUSD)) / totalAmountUSD;
                tempData[owner].token1 += (BN2Number(amount1) * parseInt(swap.amountUSD)) / totalAmountUSD;
              }
            } catch {
              j += 2;
            }
          }

          // ============================== VENEWO BOOSTING =============================
          // TODO: need to modify the equation for boosts here based of current veNEWO curve
          // if (chainId === 1) {
          //   let totalToken0 = 0;
          //   let totalToken1 = 0;
          //   let totalFees = 0;
          //   Object.values(tempData).forEach((p) => {
          //     totalToken0 += p.token0;
          //     totalToken1 += p.token1;
          //     totalFees += p.fees;
          //   });

          //   calls = [];
          //   j = 0;
          //   for (const h of Object.keys(tempData)) {
          //     calls.push({
          //       canFail: true,
          //       data: veNEWOInterface.encodeFunctionData('balanceOf', [h]),
          //       target: CONTRACTS_ADDRESSES.veNEWO,
          //     });
          //   }

          //   const fetchedVeNewoData = multicall.interface.decodeFunctionResult(
          //     'multiCall',
          //     await mainnetProvider.call(
          //       { data: multicall.interface.encodeFunctionData('multiCall', [calls]), to: mainnetMulticallAddress },
          //       parseInt(swap.transaction.blockNumber)
          //     )
          //   )[0];
          //   let supply = BigNumber.from(0);
          //   for (const holder of Object.keys(tempData)) {
          //     const veNEWOBalance = veNEWOInterface.decodeFunctionResult('balanceOf', fetchedVeNewoData[j++])[0];
          //     supply = supply.add(veNEWOBalance);
          //   }
          //   j = 0;
          //   for (const holder of Object.keys(tempData)) {
          //     const veNEWOBalance = veNEWOInterface.decodeFunctionResult('balanceOf', fetchedVeNewoData[j++])[0];
          //     const boostFees =
          //       1 +
          //       (tempData[holder].fees === 0
          //         ? 0
          //         : Math.min(1.5, (1.5 * BN2Number(veNEWOBalance)) / BN2Number(supply) / (tempData[holder].fees / totalFees)));
          //     const boostToken0 =
          //       1 +
          //       (tempData[holder].token0 === 0
          //         ? 0
          //         : Math.min(1.5, (1.5 * BN2Number(veNEWOBalance)) / BN2Number(supply) / (tempData[holder].token0 / totalToken0)));
          //     const boostToken1 =
          //       1 +
          //       (tempData[holder].token1 === 0
          //         ? 0
          //         : Math.min(1.5, (1.5 * BN2Number(veNEWOBalance)) / BN2Number(supply) / (tempData[holder].token1 / totalToken1)));

          //     // Eventually change the previous results based on the veNEWO balance
          //     tempData[holder].fees *= boostFees;
          //     tempData[holder].token0 *= boostToken0;
          //     tempData[holder].token1 *= boostToken1;
          //   }
          // }

          // Add the new temp data to the global data object©
          Object.keys(tempData).forEach((h) => {
            if (!data[utils.getAddress(h)]) data[utils.getAddress(h)] = { fees: 0, token0: 0, token1: 0 };
            data[utils.getAddress(h)].fees += tempData[h].fees;
            data[utils.getAddress(h)].token0 += tempData[h].token0;
            data[utils.getAddress(h)].token1 += tempData[h].token1;
          });
          index = index + 1;

          console.log(
            `==================================== ${params.name} ${((index * 100) / swaps.length).toFixed(
              2
            )} % ===================================`
          );
        } catch (e) {
          console.log(e);
        }
      }
    } catch (e) {
      console.log(e);
    }
  }

  // Now we assume the data array is filled
  let totalToken0 = 0;
  let totalToken1 = 0;
  let totalFees = 0;
  Object.values(data).forEach((p) => {
    totalToken0 += p.token0;
    totalToken1 += p.token1;
    totalFees += p.fees;
  });

  const rewards: { [holder: string]: number } = {};
  for (const holder of Object.keys(data)) {
    const ratio =
      (params.weights.fees * data[holder].fees) / totalFees +
      (params.weights.token0 * data[holder].token0) / totalToken0 +
      (params.weights.token1 * data[holder].token1) / totalToken1;
    rewards[holder] = !!rewards[holder] ? rewards[holder] : 0 + BN2Number(weeklyRewards) * ratio;
  }

  return rewards;
}
