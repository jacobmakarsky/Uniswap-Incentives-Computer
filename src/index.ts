import 'dotenv/config';

import express from 'express';
import moment from 'moment';

import { publishToGithubRepo } from './github';
import { ChainId, CONTRACTS_ADDRESSES } from './globals';
import { requireEnvVars } from './provider';
import { computeUniswapV3Incentives } from './script';
import { addLastWeekRewards, RewardType, updateRewards, uploadAndPush } from './utils';

const app = express();

// ================================= PARAMETERS ================================
// Corresponds to how much swap per week you want to consider at most
const { SWAP_TO_CONSIDER } = requireEnvVars(['SWAP_TO_CONSIDER']);

// ================================ MIDDLEWARES ================================
if (process.env.PRODUCTION_SETUP === 'true' && !!process.env.HEADER_KEY && !!process.env.HEADER_VALUE) {
  app.use('/mainnet', (req, res, next) => {
    if (req.get(process.env.HEADER_KEY as string) === process.env.HEADER_VALUE) {
      next();
    } else {
      res.status(403).send('Incorrect authentication');
    }
  });
}

// =================================== ROUTES ==================================
app.get('/mainnet', async (req, res) => {
  console.log('Mainnet route taken...');
  interface uniswapIncentiveParameters {
    //todo globalize
    name: string;
    weights: { fees: number; token0: number; token1: number };
    uniswapV3poolAddress: string;
    NEWO: string;
  }

  // gets passed into the compute function
  const NEWO_USDC: uniswapIncentiveParameters = {
    name: 'NEWO / USDC',
    weights: { fees: 0.4, token0: 0.4, token1: 0.2 }, // todo make sure these are the weights we want
    uniswapV3poolAddress: CONTRACTS_ADDRESSES.poolAddress,
    NEWO: CONTRACTS_ADDRESSES.NEWO,
  };

  // initialize rewards as empty
  const rewards: RewardType = {};

  // call updateRewards with the computed rewards data
  updateRewards(rewards, await computeUniswapV3Incentives(5, NEWO_USDC, parseInt(SWAP_TO_CONSIDER)), 'Uni-V3 NEWO/USDC LP');

  // // pull the old rewards from the rewards github
  // await addLastWeekRewards(rewards, ChainId.MAINNET);

  //
  if (process.env.PRODUCTION_SETUP === 'false') {
    // change for testnet if want to upload to github
    // upload to IPFS
    // await uploadAndPush(rewards, ChainId.MAINNET);

    const weekId = Math.floor(moment().unix() / (7 * 86400));
    const files = [
      {
        name: `mainnet/rewards_${weekId}.json`,
        contents: JSON.stringify(rewards),
      },
    ];

    console.log('generated files: ', files);

    // try {
    //   await publishToGithubRepo('jacobmakarsky', 'uniswapv3-rewards', files);
    // } catch (error) {
    //   console.log('Failed to publish to github repo ❌: ', error);
    // }
  }

  res.json(rewards);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on PORT: ${PORT}`));
