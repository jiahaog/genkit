/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Command } from 'commander';
import { startRunner } from '../utils/runner-utils';
import { logger } from '../utils/logger';
import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import {
  LocalFileEvalStore,
  enrichResultsWithScoring,
  EvalInput,
} from '../eval';

interface EvalRunOptions {
  output?: string;
}
/** Command to run evaluation on a dataset. */
export const evalRun = new Command('eval:run')
  .argument(
    '<dataset>',
    'Dataset to evaluate on (currently only supports JSON)'
  )
  .option(
    '--output <filename>',
    'name of the output file to write evaluation results'
  )
  .action(async (dataset: string, options: EvalRunOptions) => {
    const runner = await startRunner();
    const evalStore = new LocalFileEvalStore();

    logger.debug(`Loading data from '${dataset}'...`);
    const datasetToEval: EvalInput[] = JSON.parse(
      (await readFile(dataset)).toString('utf-8')
    ).map((testCase: any) => ({
      input: testCase.input,
      output: testCase.output,
      context: testCase.context,
      testCaseId: testCase.testCaseId || randomUUID(),
      traceIds: testCase.traceIds || [],
    }));

    const evaluatorActions = Object.keys(await runner.listActions()).filter(
      (name) => name.startsWith('/evaluator')
    );
    if (!evaluatorActions) {
      logger.error('No evaluators installed');
      return undefined;
    }
    const scores: Record<string, any> = {};
    await Promise.all(
      evaluatorActions.map(async (e) => {
        logger.info(`Running evaluator '${e}'...`);
        const response = await runner.runAction({
          key: e,
          input: {
            dataset: datasetToEval,
          },
        });
        scores[e] = response.result;
      })
    );

    const scoredResults = enrichResultsWithScoring(scores, datasetToEval);

    if (options.output) {
      logger.info(`Writing results to '${options.output}'...`);
      await writeFile(
        options.output,
        JSON.stringify(scoredResults, undefined, '  ')
      );
    }

    logger.info(`Writing results to EvalStore...`);
    await evalStore.save({
      key: {
        evalRunId: randomUUID(),
        createdAt: new Date(),
      },
      results: scoredResults,
    });

    await runner.stop();
  });
