import React, { useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  VStack,
  FormControl,
  FormLabel,
  Select,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Text,
  Box,
  Alert,
  AlertIcon,
  useToast
} from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import { postEnhanceCollectionIndex } from '@/web/core/dataset/api';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { getErrText } from '@fastgpt/global/common/error/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName: string;
  dataCount: number;
  onSuccess?: () => void;
}

const EnhanceIndexModal = ({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  dataCount,
  onSuccess
}: Props) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { llmModelList } = useSystemStore();

  const [autoIndexesModel, setAutoIndexesModel] = useState('');
  const [autoIndexesSize, setAutoIndexesSize] = useState(3);

  const { mutate: onEnhanceIndex, isLoading } = useRequest({
    mutationFn: async () => {
      const result = await postEnhanceCollectionIndex({
        collectionId,
        autoIndexesModel: autoIndexesModel || undefined,
        autoIndexesSize
      });
      return result;
    },
    onSuccess: (result) => {
      toast({
        title: t('common:Success'),
        description: result.message,
        status: 'success'
      });
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast({
        title: t('common:Error'),
        description: getErrText(error),
        status: 'error'
      });
    }
  });

  const handleClose = () => {
    if (isLoading) return;
    onClose();
  };

  // 过滤可用的LLM模型
  const availableLLMModels = llmModelList.filter(
    (model) => model.name && !model.name.includes('embedding') && !model.name.includes('rerank')
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{t('dataset:enhance_index_title')}</ModalHeader>
        {!isLoading && <ModalCloseButton />}

        <ModalBody>
          <VStack spacing={4} align="stretch">
            <Box>
              <Text fontSize="sm" color="gray.600" mb={2}>
                {t('dataset:enhance_index_desc', {
                  collectionName,
                  dataCount
                })}
              </Text>

              <Alert status="info" size="sm">
                <AlertIcon />
                <Text fontSize="xs">{t('dataset:enhance_index_warning')}</Text>
              </Alert>
            </Box>

            <FormControl>
              <FormLabel fontSize="sm">{t('dataset:auto_indexes_model')}</FormLabel>
              <Select
                value={autoIndexesModel}
                onChange={(e) => setAutoIndexesModel(e.target.value)}
                placeholder={t('dataset:use_default_model')}
              >
                {availableLLMModels.map((model) => (
                  <option key={model.model} value={model.model}>
                    {model.name}
                  </option>
                ))}
              </Select>
              <Text fontSize="xs" color="gray.500" mt={1}>
                {t('dataset:auto_indexes_model_desc')}
              </Text>
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm">{t('dataset:auto_indexes_size')}</FormLabel>
              <NumberInput
                value={autoIndexesSize}
                onChange={(_, value) => setAutoIndexesSize(value || 10)}
                min={1}
                max={20}
                size="sm"
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
              <Text fontSize="xs" color="gray.500" mt={1}>
                {t('dataset:auto_indexes_size_desc')}
              </Text>
            </FormControl>
          </VStack>
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={handleClose} isDisabled={isLoading}>
            {t('common:Cancel')}
          </Button>
          <Button
            colorScheme="blue"
            onClick={onEnhanceIndex}
            isLoading={isLoading}
            loadingText={t('dataset:enhancing_index')}
          >
            {t('dataset:start_enhance_index')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default EnhanceIndexModal;
