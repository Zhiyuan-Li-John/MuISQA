import {
  type DispatchNodeResponseType,
  type DispatchNodeResultType
} from '@fastgpt/global/core/workflow/runtime/type.d';
import { formatModelChars2Points } from '../../../../support/wallet/usage/utils';
import type { SelectedDatasetType } from '@fastgpt/global/core/workflow/api.d';
import type {
  SearchDataResponseItemType,
  DatasetVariablesType
} from '@fastgpt/global/core/dataset/type';
import type { ModuleDispatchProps } from '@fastgpt/global/core/workflow/runtime/type';
import { getEmbeddingModel, getRerankModel } from '../../../ai/model';
import { deepRagSearch, defaultSearchDatasetData } from '../../../dataset/search/controller';
import type { NodeInputKeyEnum, NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { DatasetSearchModeEnum } from '@fastgpt/global/core/dataset/constants';
import { type ChatNodeUsageType } from '@fastgpt/global/support/wallet/bill/type';
import { MongoDataset } from '../../../dataset/schema';
import { i18nT } from '../../../../../web/i18n/utils';
import { filterDatasetsByTmbId } from '../../../dataset/utils';
import { ModelTypeEnum } from '@fastgpt/global/core/ai/model';
import { addEndpointToImageUrl } from '../../../../common/file/image/utils';
import { getDatasetSearchToolResponsePrompt } from '../../../../../global/core/ai/prompt/dataset';

type DatasetSearchProps = ModuleDispatchProps<{
  [NodeInputKeyEnum.datasetSelectList]: SelectedDatasetType;
  [NodeInputKeyEnum.datasetSimilarity]: number;
  [NodeInputKeyEnum.datasetMaxTokens]: number;
  [NodeInputKeyEnum.userChatInput]?: string;
  [NodeInputKeyEnum.datasetSearchMode]: `${DatasetSearchModeEnum}`;
  [NodeInputKeyEnum.datasetSearchEmbeddingWeight]?: number;

  [NodeInputKeyEnum.datasetSearchUsingReRank]: boolean;
  [NodeInputKeyEnum.datasetSearchRerankModel]?: string;
  [NodeInputKeyEnum.datasetSearchRerankWeight]?: number;

  [NodeInputKeyEnum.collectionFilterMatch]: string;
  [NodeInputKeyEnum.authTmbId]?: boolean;

  [NodeInputKeyEnum.datasetSearchUsingExtensionQuery]: boolean;
  [NodeInputKeyEnum.datasetSearchExtensionModel]: string;
  [NodeInputKeyEnum.datasetSearchExtensionBg]: string;
  [NodeInputKeyEnum.datasetSearchUsingHyfe]: boolean;

  [NodeInputKeyEnum.datasetDeepSearch]?: boolean;
  [NodeInputKeyEnum.datasetDeepSearchModel]?: string;
  [NodeInputKeyEnum.datasetDeepSearchMaxTimes]?: number;
  [NodeInputKeyEnum.datasetDeepSearchBg]?: string;
}>;
export type DatasetSearchResponse = DispatchNodeResultType<{
  [NodeOutputKeyEnum.datasetQuoteQA]: SearchDataResponseItemType[];
}>;

export async function dispatchDatasetSearch(
  props: DatasetSearchProps
): Promise<DatasetSearchResponse> {
  const {
    runningAppInfo: { teamId },
    runningUserInfo: { tmbId },
    histories,
    node,
    variables,
    params: {
      datasets = [],
      similarity,
      limit = 5000,
      userChatInput = '',
      authTmbId = false,
      collectionFilterMatch,
      searchMode,
      embeddingWeight,
      usingReRank,
      rerankModel,
      rerankWeight,

      datasetSearchUsingExtensionQuery,
      datasetSearchExtensionModel,
      datasetSearchExtensionBg,
      datasetSearchUsingHyfe,

      datasetDeepSearch,
      datasetDeepSearchModel,
      datasetDeepSearchMaxTimes,
      datasetDeepSearchBg
    }
  } = props as DatasetSearchProps;

  if (!Array.isArray(datasets)) {
    return Promise.reject(i18nT('chat:dataset_quote_type error'));
  }

  if (datasets.length === 0) {
    return Promise.reject(i18nT('common:core.chat.error.Select dataset empty'));
  }

  const emptyResult = {
    quoteQA: [],
    [DispatchNodeResponseKeyEnum.nodeResponse]: {
      totalPoints: 0,
      query: '',
      limit,
      searchMode
    },
    nodeDispatchUsages: [],
    [DispatchNodeResponseKeyEnum.toolResponses]: []
  };

  if (!userChatInput) {
    return emptyResult;
  }

  const datasetIds = authTmbId
    ? await filterDatasetsByTmbId({
        datasetIds: datasets.map((item) => item.datasetId),
        tmbId
      })
    : await Promise.resolve(datasets.map((item) => item.datasetId));

  if (datasetIds.length === 0) {
    return emptyResult;
  }

  // 处理variables中的datasets配置，支持collectionIds过滤
  let customCollectionFilterMatch = collectionFilterMatch;
  if (variables?.datasets && Array.isArray(variables.datasets)) {
    const variableDatasets = variables.datasets as Array<{
      datasetId: string;
      collectionIds?: string[];
    }>;

    // 收集所有指定的collectionIds
    const specifiedCollectionIds: string[] = [];
    variableDatasets.forEach((dataset) => {
      if (dataset.collectionIds && Array.isArray(dataset.collectionIds)) {
        specifiedCollectionIds.push(...dataset.collectionIds);
      }
    });

    // 如果有指定的collectionIds，创建或修改collectionFilterMatch
    if (specifiedCollectionIds.length > 0) {
      try {
        const existingFilter = customCollectionFilterMatch
          ? typeof customCollectionFilterMatch === 'object'
            ? customCollectionFilterMatch
            : JSON.parse(customCollectionFilterMatch)
          : {};

        // 添加collectionIds过滤条件
        const newFilter = {
          ...existingFilter,
          collectionIds: {
            $in: specifiedCollectionIds
          }
        };

        customCollectionFilterMatch = JSON.stringify(newFilter);
      } catch (error) {
        // 如果解析失败，直接使用collectionIds过滤
        customCollectionFilterMatch = JSON.stringify({
          collectionIds: {
            $in: specifiedCollectionIds
          }
        });
      }
    }
  }

  // 处理variables中的搜索参数配置
  const variableSearchParams = variables?.searchParams || {};

  // 合并搜索参数，variables优先级更高
  const finalSimilarity = variableSearchParams.similarity ?? similarity;
  const finalLimit = variableSearchParams.limit ?? limit;
  const finalSearchMode = variableSearchParams.searchMode ?? searchMode;
  const finalEmbeddingWeight = variableSearchParams.embeddingWeight ?? embeddingWeight;
  const finalUsingReRank = variableSearchParams.usingReRank ?? usingReRank;
  const finalRerankModel = variableSearchParams.rerankModel ?? rerankModel;
  const finalRerankWeight = variableSearchParams.rerankWeight ?? rerankWeight;
  const finalDatasetSearchUsingExtensionQuery =
    variableSearchParams.datasetSearchUsingExtensionQuery ?? datasetSearchUsingExtensionQuery;
  const finalDatasetSearchExtensionModel =
    variableSearchParams.datasetSearchExtensionModel ?? datasetSearchExtensionModel;
  const finalDatasetSearchExtensionBg =
    variableSearchParams.datasetSearchExtensionBg ?? datasetSearchExtensionBg;
  const finalDatasetSearchExtensionQueries = variableSearchParams.datasetSearchExtensionQueries;
  const finalDatasetSearchUsingHyfe =
    variableSearchParams.datasetSearchUsingHyfe ?? datasetSearchUsingHyfe;
  const finalDatasetDeepSearch = variableSearchParams.datasetDeepSearch ?? datasetDeepSearch;
  const finalDatasetDeepSearchModel =
    variableSearchParams.datasetDeepSearchModel ?? datasetDeepSearchModel;
  const finalDatasetDeepSearchMaxTimes =
    variableSearchParams.datasetDeepSearchMaxTimes ?? datasetDeepSearchMaxTimes;
  const finalDatasetDeepSearchBg = variableSearchParams.datasetDeepSearchBg ?? datasetDeepSearchBg;

  // 打印调试信息
  if (Object.keys(variableSearchParams).length > 0) {
    console.log('Dataset search params from variables:', variableSearchParams);
  }

  // get vector
  const vectorModel = getEmbeddingModel(
    (await MongoDataset.findById(datasets[0].datasetId, 'vectorModel').lean())?.vectorModel
  );
  // Get Rerank Model
  const rerankModelData = getRerankModel(finalRerankModel);

  // start search
  const searchData = {
    histories,
    teamId,
    reRankQuery: userChatInput,
    queries: [userChatInput],
    model: vectorModel.model,
    similarity: finalSimilarity,
    limit: finalLimit,
    datasetIds,
    searchMode: finalSearchMode,
    embeddingWeight: finalEmbeddingWeight,
    usingReRank: finalUsingReRank,
    rerankModel: rerankModelData,
    rerankWeight: finalRerankWeight,
    collectionFilterMatch: customCollectionFilterMatch
  };
  const {
    searchRes,
    embeddingTokens,
    reRankInputTokens,
    usingSimilarityFilter,
    usingReRank: searchUsingReRank,
    queryExtensionResult,
    deepSearchResult
  } = finalDatasetDeepSearch
    ? await deepRagSearch({
        ...searchData,
        datasetDeepSearchModel: finalDatasetDeepSearchModel,
        datasetDeepSearchMaxTimes: finalDatasetDeepSearchMaxTimes,
        datasetDeepSearchBg: finalDatasetDeepSearchBg
      })
    : await defaultSearchDatasetData({
        ...searchData,
        datasetSearchUsingExtensionQuery: finalDatasetSearchUsingExtensionQuery,
        datasetSearchExtensionModel: finalDatasetSearchExtensionModel,
        datasetSearchExtensionBg: finalDatasetSearchExtensionBg,
        datasetSearchExtensionQueries: finalDatasetSearchExtensionQueries,
        datasetSearchUsingHyfe: finalDatasetSearchUsingHyfe
      });

  // count bill results
  const nodeDispatchUsages: ChatNodeUsageType[] = [];
  // vector
  const { totalPoints: embeddingTotalPoints, modelName: embeddingModelName } =
    formatModelChars2Points({
      model: vectorModel.model,
      inputTokens: embeddingTokens,
      modelType: ModelTypeEnum.embedding
    });
  nodeDispatchUsages.push({
    totalPoints: embeddingTotalPoints,
    moduleName: node.name,
    model: embeddingModelName,
    inputTokens: embeddingTokens
  });
  // Rerank
  const { totalPoints: reRankTotalPoints, modelName: reRankModelName } = formatModelChars2Points({
    model: rerankModelData?.model,
    inputTokens: reRankInputTokens,
    modelType: ModelTypeEnum.rerank
  });
  if (usingReRank) {
    nodeDispatchUsages.push({
      totalPoints: reRankTotalPoints,
      moduleName: node.name,
      model: reRankModelName,
      inputTokens: reRankInputTokens
    });
  }
  // Query extension
  (() => {
    if (queryExtensionResult) {
      const { totalPoints, modelName } = formatModelChars2Points({
        model: queryExtensionResult.model,
        inputTokens: queryExtensionResult.inputTokens,
        outputTokens: queryExtensionResult.outputTokens,
        modelType: ModelTypeEnum.llm
      });
      nodeDispatchUsages.push({
        totalPoints,
        moduleName: i18nT('common:core.module.template.Query extension'),
        model: modelName,
        inputTokens: queryExtensionResult.inputTokens,
        outputTokens: queryExtensionResult.outputTokens
      });
      return {
        totalPoints
      };
    }
    return {
      totalPoints: 0
    };
  })();
  // Deep search
  (() => {
    if (deepSearchResult) {
      const { totalPoints, modelName } = formatModelChars2Points({
        model: deepSearchResult.model,
        inputTokens: deepSearchResult.inputTokens,
        outputTokens: deepSearchResult.outputTokens,
        modelType: ModelTypeEnum.llm
      });
      nodeDispatchUsages.push({
        totalPoints,
        moduleName: i18nT('common:deep_rag_search'),
        model: modelName,
        inputTokens: deepSearchResult.inputTokens,
        outputTokens: deepSearchResult.outputTokens
      });
      return {
        totalPoints
      };
    }
    return {
      totalPoints: 0
    };
  })();

  const totalPoints = nodeDispatchUsages.reduce((acc, item) => acc + item.totalPoints, 0);

  const responseData: DispatchNodeResponseType & { totalPoints: number } = {
    totalPoints,
    query: userChatInput,
    embeddingModel: vectorModel.name,
    embeddingTokens,
    similarity: usingSimilarityFilter ? finalSimilarity : undefined,
    limit: finalLimit,
    searchMode: finalSearchMode,
    embeddingWeight:
      finalSearchMode === DatasetSearchModeEnum.mixedRecall ? finalEmbeddingWeight : undefined,
    // Rerank
    ...(searchUsingReRank && {
      rerankModel: rerankModelData?.name,
      rerankWeight: finalRerankWeight,
      reRankInputTokens
    }),
    searchUsingReRank,
    // Results
    quoteList: searchRes,
    queryExtensionResult,
    deepSearchResult
  };

  return {
    quoteQA: searchRes,
    [DispatchNodeResponseKeyEnum.nodeResponse]: responseData,
    nodeDispatchUsages,
    [DispatchNodeResponseKeyEnum.toolResponses]: {
      prompt: getDatasetSearchToolResponsePrompt(),
      cites: searchRes.map((item) => ({
        id: item.id,
        sourceName: item.sourceName,
        updateTime: item.updateTime,
        content: addEndpointToImageUrl(`${item.q}\n${item.a}`.trim())
      }))
    }
  };
}
