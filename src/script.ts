import { ChainId, CONTRACTS_ADDRESSES } from '@angleprotocol/sdk';
import {
  AngleDistributor,
  AngleDistributor__factory,
  GaugeController,
  GaugeController__factory,
} from '@angleprotocol/sdk/dist/constants/types';
import { BigNumber, Contract, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { gql, request } from 'graphql-request';
import moment from 'moment';

import { arrakisInterface, gammaInterface, multicallABI, uniswapV3Interface } from './abis';
import { httpProvider } from './provider';
import { getAmountsForLiquidity, getLiquidityForAmounts } from './uniswap';
import { BN2Number } from './utils';

async function fetchWeeklyTokenHolder(token: string, week: number, chainId: ChainId) {
  // Graph made to easily track holders of a token during a given week
  // See https://github.com/AngleProtocol/weekly_holder_subgraph
  const weeks = [0, week];
  let auxWeek = week + 1;
  while (auxWeek <= Math.floor(moment().unix() / (7 * 24 * 3600))) {
    weeks.push(auxWeek);
    auxWeek += 1;
  }
  const urlTG =
    chainId === 1
      ? 'https://api.thegraph.com/subgraphs/name/picodes/weekly-token-holders'
      : 'https://api.thegraph.com/subgraphs/name/picodes/polygon-weekly-token-holder';
  const query = gql`
    query Holders($where: [Int!], $token: String!) {
      holders(where: { week_in: $where, token: $token }) {
        holder
      }
    }
  `;
  const data = await request<{
    holders: { holder: string }[];
  }>(urlTG as string, query, {
    token: token,
    where: weeks,
  });
  return data.holders?.map((e) => e.holder);
}

async function fetchPositionsAndSwaps(pool: string, week: number, chainId: ChainId, first: number) {
  const tg_uniswap =
    chainId === 1
      ? 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'
      : 'https://api.thegraph.com/subgraphs/name/zephyrys/uniswap-polygon-but-it-works';

  const positionQuery = gql`
    query getPositions($pool: String!, $uTimestamp: Int!, $lTimestamp: Int!, $first: Int!) {
      positionSnapshots(where: { pool_: { id: $pool } }) {
        position {
          id
        }
      }
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
  `;
  const data = await request<{
    positionSnapshots: { position: { id: string } }[];
    swaps: {
      amountUSD: string;
      tick: string;
      sqrtPriceX96: string;
      timestamp: string;
      transaction: { blockNumber: string };
    }[];
  }>(tg_uniswap as string, positionQuery, {
    lTimestamp: week * (7 * 24 * 3600),
    pool: pool,
    uTimestamp: week * (7 * 24 * 3600) + 7 * 24 * 3600,
    first,
  });
  const positions = data?.positionSnapshots?.map((e) => e?.position.id);
  const swaps = data.swaps.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  return { positions, swaps };
}

// ================================= PARAMETERS ================================

interface uniswapIncentiveParameters {
  name: string;
  weights: { fees: number; token0: number; token1: number };
  uniswapV3poolAddress: string;
  arrakisPoolAddress: string;
  arrakisGaugeAddress: string;
  gaugeAddress: string;
  gammaPoolAddress: string | null;
  agEUR: string;
}

// =================================== LOGIC ===================================

export async function computeUniswapV3Incentives(chainId: 1 | 137, params: uniswapIncentiveParameters, first: number) {
  const provider = httpProvider(chainId); // ethers.provider
  const mainnetProvider = httpProvider(ChainId.MAINNET); // ethers.provider
  const multicallAddress = CONTRACTS_ADDRESSES[chainId]?.MulticallWithFailure as string;
  const mainnetMulticallAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET]?.MulticallWithFailure as string;
  const weekInPast = 1;
  const week = Math.floor(moment().unix() / (7 * 24 * 3600)) - weekInPast;
  const secondsInWeek = 7 * 24 * 3600;

  // Fetch weekly rewards
  const gaugeController = new Contract(
    CONTRACTS_ADDRESSES[ChainId.MAINNET].GaugeController as string,
    GaugeController__factory.abi,
    mainnetProvider
  ) as GaugeController;
  const angleDistributor = new Contract(
    CONTRACTS_ADDRESSES[ChainId.MAINNET].AngleDistributor as string,
    AngleDistributor__factory.abi,
    mainnetProvider
  ) as AngleDistributor;
  const gaugeWeight = await gaugeController['gauge_relative_weight(address,uint256)'](params.gaugeAddress, week * secondsInWeek);
  const rewardRate = await angleDistributor.rate();
  const reductionRate = await angleDistributor.RATE_REDUCTION_COEFFICIENT();
  const elapsedWeeks = -weekInPast; // Compute rewards for last week

  let weeklyRewards = rewardRate.mul(secondsInWeek);
  for (let i = 1; i <= elapsedWeeks; i++) {
    weeklyRewards = weeklyRewards.mul(parseEther('1')).div(reductionRate);
  }
  if (elapsedWeeks < 0) {
    for (let i = 1; i <= -elapsedWeeks; i++) {
      weeklyRewards = weeklyRewards.mul(reductionRate).div(parseEther('1'));
    }
  }
  weeklyRewards = weeklyRewards.mul(gaugeWeight).div(parseEther('1'));

  // Data object that we'll fill
  const data: { [holder: string]: { fees: number; token0: number; token1: number } } = {};
  if (!!params.agEUR && !!multicallAddress) {
    // Uses a custom multicall contract that accept reverts
    const multicall = new Contract(multicallAddress, multicallABI, provider);

    try {
      // Fetch Uniswap V3 positions and swaps
      const { positions, swaps } = await fetchPositionsAndSwaps(params.uniswapV3poolAddress?.toLowerCase(), week, chainId, first);
      let totalAmountUSD = 0;
      swaps.forEach((s) => (totalAmountUSD += parseInt(s.amountUSD)));

      // Fetch Arrakis Holders over the week
      const arrakisHolders = await fetchWeeklyTokenHolder(params.arrakisPoolAddress?.toLowerCase(), week, chainId);
      const arrakisGaugeHolders = await fetchWeeklyTokenHolder(params.arrakisGaugeAddress?.toLowerCase(), week, chainId);

      // Fetch Gamma Holders over the week
      let gammaHolders: string[] = [];
      if (params.gammaPoolAddress !== null) {
        gammaHolders = await fetchWeeklyTokenHolder((params.gammaPoolAddress as string)?.toLowerCase(), week, chainId);
      }

      // Loop through each swap of the week
      let index = 0;
      for (const swap of swaps) {
        const tempData: { [holder: string]: { fees: number; token0: number; token1: number } } = {};

        try {
          // ============================== UNISWAP V3 NFTS ==============================

          let calls = [];
          for (const id of positions) {
            calls.push({
              canFail: true,
              data: uniswapV3Interface.encodeFunctionData('positions', [BigNumber.from(id)]),
              target: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
            });
            calls.push({
              canFail: true,
              data: uniswapV3Interface.encodeFunctionData('ownerOf', [BigNumber.from(id)]),
              target: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
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

          // ================================== ARRAKIS ==================================

          calls = [];
          j = 0;
          if (params.arrakisPoolAddress !== null) {
            calls.push({
              canFail: true,
              data: arrakisInterface.encodeFunctionData('getUnderlyingBalances'),
              target: params.arrakisPoolAddress,
            });
            calls.push({
              canFail: true,
              data: arrakisInterface.encodeFunctionData('lowerTick'),
              target: params.arrakisPoolAddress,
            });
            calls.push({
              canFail: true,
              data: arrakisInterface.encodeFunctionData('upperTick'),
              target: params.arrakisPoolAddress,
            });
            for (const account of arrakisHolders) {
              calls.push({
                canFail: true,
                data: arrakisInterface.encodeFunctionData('balanceOf', [account]),
                target: params.arrakisPoolAddress,
              });
            }
            for (const account of arrakisGaugeHolders) {
              calls.push({
                canFail: true,
                data: arrakisInterface.encodeFunctionData('balanceOf', [account]),
                target: params.arrakisGaugeAddress,
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

            try {
              const amount0 = arrakisInterface.decodeFunctionResult('getUnderlyingBalances', fetchedData[j])[0];
              const amount1 = arrakisInterface.decodeFunctionResult('getUnderlyingBalances', fetchedData[j++])[1];
              const token0 = (BN2Number(amount0) * parseInt(swap.amountUSD)) / totalAmountUSD;
              const token1 = (BN2Number(amount1) * parseInt(swap.amountUSD)) / totalAmountUSD;
              const lowerTick = parseFloat(arrakisInterface.decodeFunctionResult('lowerTick', fetchedData[j++])[0]?.toString());
              const upperTick = parseFloat(arrakisInterface.decodeFunctionResult('upperTick', fetchedData[j++])[0]?.toString());
              const posLiquidity = getLiquidityForAmounts(parseFloat(swap.tick), lowerTick, upperTick, amount0, amount1);
              const fees = parseFloat(swap.amountUSD) * BN2Number(posLiquidity);

              // Split the result among holders
              let supply = BigNumber.from(0);
              for (const holder of arrakisHolders) {
                const arrakisBalance = arrakisInterface.decodeFunctionResult('balanceOf', fetchedData[j++])[0];
                supply = supply.add(arrakisBalance);
              }

              let gaugeFactor = 0;
              j = j - arrakisHolders.length;
              for (const holder of arrakisHolders) {
                const ratio = BN2Number(arrakisInterface.decodeFunctionResult('balanceOf', fetchedData[j++])[0]) / BN2Number(supply);
                if (utils.getAddress(holder) === utils.getAddress(params.arrakisGaugeAddress)) {
                  gaugeFactor = ratio;
                } else {
                  if (lowerTick < parseFloat(swap.tick) && parseFloat(swap.tick) < upperTick) {
                    if (!tempData[holder]) tempData[holder] = { fees: 0, token0: 0, token1: 0 };
                    tempData[holder].fees += fees * ratio;
                    tempData[holder].token0 += token0 * ratio;
                    tempData[holder].token1 += token1 * ratio;
                  }
                }
              }

              // Split the result among stakers
              supply = BigNumber.from(0);
              for (const holder of arrakisGaugeHolders) {
                const gaugeTokenBalance = arrakisInterface.decodeFunctionResult('balanceOf', fetchedData[j++])[0];
                supply = supply.add(gaugeTokenBalance);
              }

              j = j - arrakisGaugeHolders.length;
              for (const holder of arrakisGaugeHolders) {
                const ratio = BN2Number(arrakisInterface.decodeFunctionResult('balanceOf', fetchedData[j++])[0]) / BN2Number(supply);
                if (lowerTick < parseFloat(swap.tick) && parseFloat(swap.tick) < upperTick) {
                  if (!tempData[holder]) tempData[holder] = { fees: 0, token0: 0, token1: 0 };
                  tempData[holder].fees += fees * ratio * gaugeFactor;
                  tempData[holder].token0 += token0 * ratio * gaugeFactor;
                  tempData[holder].token1 += token1 * ratio * gaugeFactor;
                }
              }
            } catch {
              j += 2;
            }
          }

          // =================================== GAMMA ===================================

          calls = [];
          j = 0;
          if (params.gammaPoolAddress !== null) {
            calls.push({
              canFail: true,
              data: gammaInterface.encodeFunctionData('baseLower'),
              target: params.gammaPoolAddress,
            });
            calls.push({
              canFail: true,
              data: gammaInterface.encodeFunctionData('baseUpper'),
              target: params.gammaPoolAddress,
            });
            calls.push({
              canFail: true,
              data: gammaInterface.encodeFunctionData('getBasePosition'),
              target: params.gammaPoolAddress,
            });
            calls.push({
              canFail: true,
              data: gammaInterface.encodeFunctionData('limitLower'),
              target: params.gammaPoolAddress,
            });
            calls.push({
              canFail: true,
              data: gammaInterface.encodeFunctionData('limitUpper'),
              target: params.gammaPoolAddress,
            });
            calls.push({
              canFail: true,
              data: gammaInterface.encodeFunctionData('getLimitPosition'),
              target: params.gammaPoolAddress,
            });
            for (const holder of gammaHolders) {
              calls.push({
                canFail: true,
                data: arrakisInterface.encodeFunctionData('balanceOf', [holder]),
                target: params.gammaPoolAddress,
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
            let liquidity = BigNumber.from(0);
            let amount0 = BigNumber.from(0);
            let amount1 = BigNumber.from(0);
            const baseLower = parseInt(gammaInterface.decodeFunctionResult('baseLower', fetchedData[j++])[0]?.toString());
            const baseUpper = parseInt(gammaInterface.decodeFunctionResult('baseUpper', fetchedData[j++])[0]?.toString());
            if (baseLower < parseInt(swap.tick) && parseInt(swap.tick) < baseUpper) {
              liquidity = liquidity.add(gammaInterface.decodeFunctionResult('getBasePosition', fetchedData[j])[0]);
              amount0 = amount0.add(gammaInterface.decodeFunctionResult('getBasePosition', fetchedData[j])[1]);
              amount1 = amount1.add(gammaInterface.decodeFunctionResult('getBasePosition', fetchedData[j++])[2]);
            } else {
              j++;
            }
            const limitLower = parseInt(gammaInterface.decodeFunctionResult('limitLower', fetchedData[j++])[0]?.toString());
            const limitUpper = parseInt(gammaInterface.decodeFunctionResult('limitUpper', fetchedData[j++])[0]?.toString());
            if (limitLower < parseInt(swap.tick) && parseInt(swap.tick) < limitUpper) {
              liquidity = liquidity.add(gammaInterface.decodeFunctionResult('getLimitPosition', fetchedData[j])[0]);
              amount0 = amount0.add(gammaInterface.decodeFunctionResult('getLimitPosition', fetchedData[j])[1]);
              amount1 = amount1.add(gammaInterface.decodeFunctionResult('getLimitPosition', fetchedData[j++])[2]);
            } else {
              j++;
            }
            const token0 = (BN2Number(amount0) * parseInt(swap.amountUSD)) / totalAmountUSD;
            const token1 = (BN2Number(amount1) * parseInt(swap.amountUSD)) / totalAmountUSD;
            const fees = parseFloat(swap.amountUSD) * BN2Number(liquidity);

            // Split the result among holders
            let supply = BigNumber.from(0);
            for (const holder of gammaHolders) {
              const gammaBalance = arrakisInterface.decodeFunctionResult('balanceOf', fetchedData[j++])[0];
              supply = supply.add(gammaBalance);
            }

            j = j - gammaHolders.length;
            for (const holder of gammaHolders) {
              const ratio = BN2Number(arrakisInterface.decodeFunctionResult('balanceOf', fetchedData[j++])[0]) / BN2Number(supply);
              if (!tempData[holder]) tempData[holder] = { fees: 0, token0: 0, token1: 0 };
              tempData[holder].fees += fees * ratio;
              tempData[holder].token0 += token0 * ratio;
              tempData[holder].token1 += token1 * ratio;
            }
          }

          // ============================== VEANGLE BOOSTING =============================

          if (chainId === 1) {
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
            for (const h of Object.keys(tempData)) {
              calls.push({
                canFail: true,
                data: arrakisInterface.encodeFunctionData('balanceOf', [h]),
                target: CONTRACTS_ADDRESSES[ChainId.MAINNET].veANGLE,
              });
            }

            const fetchedVeAngleData = multicall.interface.decodeFunctionResult(
              'multiCall',
              await mainnetProvider.call(
                { data: multicall.interface.encodeFunctionData('multiCall', [calls]), to: mainnetMulticallAddress },
                parseInt(swap.transaction.blockNumber)
              )
            )[0];
            let supply = BigNumber.from(0);
            for (const holder of Object.keys(tempData)) {
              const veANGLEBalance = arrakisInterface.decodeFunctionResult('balanceOf', fetchedVeAngleData[j++])[0];
              supply = supply.add(veANGLEBalance);
            }
            j = 0;
            for (const holder of Object.keys(tempData)) {
              const veANGLEBalance = arrakisInterface.decodeFunctionResult('balanceOf', fetchedVeAngleData[j++])[0];
              const boostFees =
                1 +
                (tempData[holder].fees === 0
                  ? 0
                  : Math.min(1.5, (1.5 * BN2Number(veANGLEBalance)) / BN2Number(supply) / (tempData[holder].fees / totalFees)));
              const boostToken0 =
                1 +
                (tempData[holder].token0 === 0
                  ? 0
                  : Math.min(1.5, (1.5 * BN2Number(veANGLEBalance)) / BN2Number(supply) / (tempData[holder].token0 / totalToken0)));
              const boostToken1 =
                1 +
                (tempData[holder].token1 === 0
                  ? 0
                  : Math.min(1.5, (1.5 * BN2Number(veANGLEBalance)) / BN2Number(supply) / (tempData[holder].token1 / totalToken1)));

              // Eventually change the previous results based on the veANGLE balance
              tempData[holder].fees *= boostFees;
              tempData[holder].token0 *= boostToken0;
              tempData[holder].token1 *= boostToken1;
            }
          }

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
