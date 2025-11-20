'use client';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Flex,
  Button,
  useDisclosure,
  useTheme,
  Input,
  Link,
  Progress,
  Grid,
  Select,
  HStack,
  VStack,
  Text,
  Spinner,
  Textarea,
  IconButton,
  Tooltip,
  ButtonGroup,
  type BoxProps
} from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import { type UserUpdateParams } from '@/types/user';
import { useToast } from '@fastgpt/web/hooks/useToast';
import { useUserStore } from '@/web/support/user/useUserStore';
import type { UserType } from '@fastgpt/global/support/user/type.d';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useSelectFile } from '@/web/common/file/hooks/useSelectFile';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import { useTranslation } from 'next-i18next';
import Avatar from '@fastgpt/web/components/common/Avatar';
import MyIcon from '@fastgpt/web/components/common/Icon';
import MyTooltip from '@fastgpt/web/components/common/MyTooltip';
import { formatStorePrice2Read } from '@fastgpt/global/support/wallet/usage/tools';
import { putUpdateMemberName, redeemCoupon } from '@/web/support/user/team/api';
import { getDocPath } from '@/web/common/system/doc';
import {
  StandardSubLevelEnum,
  standardSubLevelMap
} from '@fastgpt/global/support/wallet/sub/constants';
import { formatTime2YMD } from '@fastgpt/global/common/string/time';
import { getExtraPlanCardRoute } from '@/web/support/wallet/sub/constants';

import StandardPlanContentList from '@/components/support/wallet/StandardPlanContentList';
import QuestionTip from '@fastgpt/web/components/common/MyTooltip/QuestionTip';
import { useSystem } from '@fastgpt/web/hooks/useSystem';
import { getWebReqUrl } from '@fastgpt/web/common/system/utils';
import AccountContainer from '@/pageComponents/account/AccountContainer';
import { serviceSideProps } from '@/web/common/i18n/utils';
import { useRouter } from 'next/router';
import TeamSelector from '@/pageComponents/account/TeamSelector';
import { getWorkorderURL } from '@/web/common/workorder/api';
import { useRequest2 } from '@fastgpt/web/hooks/useRequest';
import { useMount } from 'ahooks';
import MyDivider from '@fastgpt/web/components/common/MyDivider';
import { getAllUsers, switchUser } from '@/web/support/user/api';
import { useDebounce } from 'ahooks';
import { ArrowBackIcon, ArrowForwardIcon } from '@chakra-ui/icons';

const Markdown = dynamic(() => import('@/components/Markdown'), { ssr: false });

const RedeemCouponModal = dynamic(() => import('@/pageComponents/account/info/RedeemCouponModal'), {
  ssr: false
});
const StandDetailModal = dynamic(
  () => import('@/pageComponents/account/info/standardDetailModal'),
  { ssr: false }
);
const ConversionModal = dynamic(() => import('@/pageComponents/account/info/ConversionModal'));
const UpdatePswModal = dynamic(() => import('@/pageComponents/account/info/UpdatePswModal'));
const UpdateContact = dynamic(() => import('@/components/support/user/inform/UpdateContactModal'));
const CommunityModal = dynamic(() => import('@/components/CommunityModal'));

const ModelPriceModal = dynamic(() =>
  import('@/components/core/ai/ModelTable').then((mod) => mod.ModelPriceModal)
);

const Info = () => {
  const { isPc } = useSystem();
  const { teamPlanStatus, initUserInfo } = useUserStore();
  const standardPlan = teamPlanStatus?.standardConstants;
  const { isOpen: isOpenContact, onClose: onCloseContact, onOpen: onOpenContact } = useDisclosure();

  return (
    <AccountContainer>
      <Box py={[3, '28px']} px={[5, 10]} mx={'auto'}>
        {isPc ? (
          <Flex justifyContent={'center'} maxW={'1080px'}>
            <Box flex={'0 0 330px'}>
              <MyInfo onOpenContact={onOpenContact} />
              <Box mt={6}>
                <Other onOpenContact={onOpenContact} />
              </Box>
            </Box>
            {!!standardPlan && (
              <Box ml={'45px'} flex={'1'} maxW={'600px'}>
                <PlanUsage />
              </Box>
            )}
          </Flex>
        ) : (
          <>
            <MyInfo onOpenContact={onOpenContact} />
            {standardPlan && <PlanUsage />}
            <Other onOpenContact={onOpenContact} />
          </>
        )}
      </Box>
      {isOpenContact && <CommunityModal onClose={onCloseContact} />}
    </AccountContainer>
  );
};

export async function getServerSideProps(content: any) {
  return {
    props: {
      ...(await serviceSideProps(content, ['account', 'account_info', 'user']))
    }
  };
}

export default React.memo(Info);

const MyInfo = ({ onOpenContact }: { onOpenContact: () => void }) => {
  const theme = useTheme();
  const { feConfigs } = useSystemStore();
  const { t } = useTranslation();
  const { userInfo, updateUserInfo, teamPlanStatus, initUserInfo } = useUserStore();
  const { reset } = useForm<UserUpdateParams>({
    defaultValues: userInfo as UserType
  });
  const standardPlan = teamPlanStatus?.standardConstants;
  const { isPc } = useSystem();
  const { toast } = useToast();

  const {
    isOpen: isOpenConversionModal,
    onClose: onCloseConversionModal,
    onOpen: onOpenConversionModal
  } = useDisclosure();
  const {
    isOpen: isOpenUpdatePsw,
    onClose: onCloseUpdatePsw,
    onOpen: onOpenUpdatePsw
  } = useDisclosure();
  const {
    isOpen: isOpenUpdateContact,
    onClose: onCloseUpdateContact,
    onOpen: onOpenUpdateContact
  } = useDisclosure();
  const {
    File,
    onOpen: onOpenSelectFile,
    onSelectImage
  } = useSelectFile({
    fileType: '.jpg,.png',
    multiple: false
  });

  const onclickSave = useCallback(
    async (data: UserType) => {
      await updateUserInfo({
        avatar: data.avatar,
        timezone: data.timezone
      });
      reset(data);
      toast({
        title: t('account_info:update_success_tip'),
        status: 'success'
      });
    },
    [reset, t, toast, updateUserInfo]
  );

  const labelStyles: BoxProps = {
    flex: '0 0 80px',
    color: 'var(--light-general-on-surface-lowest, var(--Gray-Modern-500, #667085))',
    fontFamily: '"PingFang SC"',
    fontSize: '14px',
    fontStyle: 'normal',
    fontWeight: 400,
    lineHeight: '20px',
    letterSpacing: '0.25px'
  };

  const titleStyles: BoxProps = {
    color: 'var(--light-general-on-surface, var(--Gray-Modern-900, #111824))',
    fontFamily: '"PingFang SC"',
    fontSize: '16px',
    fontStyle: 'normal',
    fontWeight: 500,
    lineHeight: '24px',
    letterSpacing: '0.15px'
  };

  const isSyncMember = feConfigs.register_method?.includes('sync');
  const isRoot = userInfo?.username === 'root';

  // 搜索和分页状态
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<'username' | 'accessKey'>('username');

  // chatProblem 编辑状态
  const [chatProblemContent, setChatProblemContent] = useState(userInfo?.chatProblem || '');
  const [isEditingChatProblem, setIsEditingChatProblem] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // 防抖搜索
  const debouncedSearchText = useDebounce(searchText, { wait: 300 });

  // Root用户获取所有用户列表
  const {
    data: usersData,
    refresh: refreshUsers,
    loading: loadingUsers
  } = useRequest2(
    async () => {
      if (!isRoot) return { users: [], total: 0, page: 1, limit: pageSize, totalPages: 0 };

      const params: any = {
        page: currentPage,
        limit: pageSize
      };

      if (debouncedSearchText) {
        if (searchType === 'accessKey') {
          params.accessKey = debouncedSearchText;
        } else {
          params.search = debouncedSearchText;
        }
      }

      return getAllUsers(params);
    },
    {
      manual: false,
      refreshDeps: [isRoot, currentPage, debouncedSearchText, searchType]
    }
  );

  const allUsers = usersData?.users || [];
  const totalUsers = usersData?.total || 0;
  const totalPages = usersData?.totalPages || 0;

  // 重置搜索
  const handleResetSearch = useCallback(() => {
    setSearchText('');
    setCurrentPage(1);
  }, []);

  // 当搜索条件变化时重置页码
  React.useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchText, searchType]);

  // 用户切换函数
  const handleSwitchUser = useCallback(
    async (targetUserId: string) => {
      try {
        const result = await switchUser(targetUserId);
        // 更新用户信息
        const updatedUserInfo = await initUserInfo();
        toast({
          title: `已切换到用户: ${result.user.username}`,
          status: 'success'
        });
      } catch (error) {
        toast({
          title: '切换用户失败',
          status: 'error'
        });
      }
    },
    [initUserInfo, toast]
  );

  // 保存 chatProblem 内容
  const handleSaveChatProblem = useCallback(async () => {
    try {
      await updateUserInfo({
        chatProblem: chatProblemContent
      });
      setIsEditingChatProblem(false);
      toast({
        title: '聊天问题内容更新成功',
        status: 'success'
      });
    } catch (error) {
      toast({
        title: '更新失败',
        status: 'error'
      });
    }
  }, [chatProblemContent, updateUserInfo, toast]);

  // 处理图片上传
  const handleImageUpload = useCallback(
    async (file: File) => {
      setIsUploadingImage(true);
      try {
        // 方法1：使用FormData上传（推荐）
        const useFormData = true;
        let imageUrl = '';

        if (useFormData) {
          // 使用新的FormData API
          const formData = new FormData();
          formData.append('file', file);

          const response = await fetch('/api/common/file/uploadImageFormData', {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error('上传失败');
          }

          const data = await response.json();
          imageUrl = data.data;
        } else {
          // 方法2：转换为base64后上传（备用方案）
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const response = await fetch('/api/common/file/uploadImage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              base64Img: base64,
              metadata: {
                filename: file.name,
                size: file.size
              }
            })
          });

          if (!response.ok) {
            throw new Error('上传失败');
          }

          imageUrl = await response.text();
        }

        // 插入 Markdown 图片语法到光标位置
        const textarea = document.querySelector(
          'textarea[placeholder*="Markdown"]'
        ) as HTMLTextAreaElement;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const imageMarkdown = `![${file.name}](${imageUrl})`;
          const newContent =
            chatProblemContent.substring(0, start) +
            imageMarkdown +
            chatProblemContent.substring(end);
          setChatProblemContent(newContent);

          // 设置光标位置到插入内容的末尾
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + imageMarkdown.length, start + imageMarkdown.length);
          }, 0);
        }

        toast({
          title: '图片上传成功',
          status: 'success'
        });
      } catch (error) {
        console.error('图片上传失败:', error);
        toast({
          title: '图片上传失败',
          description: error instanceof Error ? error.message : '未知错误',
          status: 'error'
        });
      } finally {
        setIsUploadingImage(false);
      }
    },
    [chatProblemContent, setChatProblemContent, toast]
  );

  // 处理文件拖拽上传
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        handleImageUpload(imageFiles[0]);
      }
    },
    [handleImageUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // 插入 Markdown 语法快捷方式
  const insertMarkdown = useCallback(
    (syntax: string, placeholder = '') => {
      const textarea = document.querySelector(
        'textarea[placeholder*="Markdown"]'
      ) as HTMLTextAreaElement;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = chatProblemContent.substring(start, end);
        const insertText = syntax.replace('{text}', selectedText || placeholder);
        const newContent =
          chatProblemContent.substring(0, start) + insertText + chatProblemContent.substring(end);
        setChatProblemContent(newContent);

        // 设置光标位置
        setTimeout(() => {
          textarea.focus();
          if (selectedText) {
            textarea.setSelectionRange(start + insertText.length, start + insertText.length);
          } else {
            // 如果没有选中文本，将光标放在占位符中间
            const placeholderStart = start + insertText.indexOf(placeholder);
            textarea.setSelectionRange(placeholderStart, placeholderStart + placeholder.length);
          }
        }, 0);
      }
    },
    [chatProblemContent, setChatProblemContent]
  );

  return (
    <Box>
      {/* user info */}
      {isPc && (
        <Flex alignItems={'center'} h={'30px'} {...titleStyles}>
          <MyIcon mr={2} name={'core/dataset/fileCollection'} w={'1.25rem'} />
          {t('account_info:general_info')}
        </Flex>
      )}

      <Box mt={[0, 6]} fontSize={'sm'}>
        <Flex alignItems={'center'}>
          <Box {...labelStyles}>{t('account_info:user_account')}&nbsp;</Box>
          <Box flex={1}>{userInfo?.username}</Box>
        </Flex>
        {feConfigs?.isPlus && (
          <Flex mt={4} alignItems={'center'}>
            <Box {...labelStyles}>{t('account_info:password')}&nbsp;</Box>
            <Box flex={1}>*****</Box>
            <Button size={'sm'} variant={'whitePrimary'} onClick={onOpenUpdatePsw}>
              {t('account_info:change')}
            </Button>
          </Flex>
        )}
        {feConfigs?.isPlus && (
          <Flex mt={4} alignItems={'center'}>
            <Box {...labelStyles}>{t('common:contact_way')}&nbsp;</Box>
            <Box flex={1} {...(!userInfo?.contact ? { color: 'red.600' } : {})}>
              {userInfo?.contact ? userInfo?.contact : t('account_info:please_bind_contact')}
            </Box>

            <Button size={'sm'} variant={'whitePrimary'} onClick={onOpenUpdateContact}>
              {t('account_info:change')}
            </Button>
          </Flex>
        )}

        <MyDivider my={6} />

        {isPc && (
          <Flex alignItems={'center'} h={'30px'} {...titleStyles} mt={6}>
            <MyIcon mr={2} name={'support/team/group'} w={'1.25rem'} />
            {t('account_info:team_info')}
          </Flex>
        )}

        {feConfigs.isPlus && (
          <Flex mt={6} alignItems={'center'}>
            <Box {...labelStyles}>{t('account_info:user_team_team_name')}&nbsp;</Box>
            <Flex flex={'1 0 0'} w={0} align={'center'}>
              <TeamSelector height={'28px'} w={'100%'} showManage />
            </Flex>
          </Flex>
        )}

        {isPc ? (
          <Flex mt={4} alignItems={'center'} cursor={'pointer'}>
            <Box {...labelStyles}>{t('account_info:avatar')}&nbsp;</Box>

            <MyTooltip label={t('account_info:select_avatar')}>
              <Box
                w={['22px', '32px']}
                h={['22px', '32px']}
                borderRadius={'50%'}
                border={theme.borders.base}
                overflow={'hidden'}
                boxShadow={'0 0 5px rgba(0,0,0,0.1)'}
                onClick={onOpenSelectFile}
              >
                <Avatar src={userInfo?.avatar} borderRadius={'50%'} w={'100%'} h={'100%'} />
              </Box>
            </MyTooltip>
          </Flex>
        ) : (
          <Flex
            flexDirection={'column'}
            alignItems={'center'}
            cursor={'pointer'}
            onClick={onOpenSelectFile}
          >
            <MyTooltip label={t('account_info:choose_avatar')}>
              <Box
                w={['44px', '54px']}
                h={['44px', '54px']}
                borderRadius={'50%'}
                border={theme.borders.base}
                overflow={'hidden'}
                p={'2px'}
                boxShadow={'0 0 5px rgba(0,0,0,0.1)'}
                mb={2}
              >
                <Avatar src={userInfo?.avatar} borderRadius={'50%'} w={'100%'} h={'100%'} />
              </Box>
            </MyTooltip>

            <Flex alignItems={'center'} fontSize={'sm'} color={'myGray.600'}>
              <MyIcon mr={1} name={'edit'} w={'14px'} />
              {t('account_info:change')}
            </Flex>
          </Flex>
        )}
        {feConfigs?.isPlus && (
          <Flex mt={[0, 4]} alignItems={'center'}>
            <Box {...labelStyles}>{t('account_info:member_name')}&nbsp;</Box>
            <Input
              flex={'1 0 0'}
              disabled={isSyncMember}
              defaultValue={userInfo?.team?.memberName || 'Member'}
              title={t('account_info:click_modify_nickname')}
              borderColor={'transparent'}
              transform={'translateX(-11px)'}
              maxLength={100}
              onBlur={async (e) => {
                const val = e.target.value;
                if (val === userInfo?.team?.memberName) return;
                try {
                  await putUpdateMemberName(val);
                  initUserInfo();
                } catch (error) {}
              }}
            />
          </Flex>
        )}
        {feConfigs?.isPlus && (userInfo?.team?.balance ?? 0) > 0 && (
          <Box mt={4} whiteSpace={'nowrap'}>
            <Flex alignItems={'center'}>
              <Box {...labelStyles}>{t('account_info:team_balance')}&nbsp;</Box>
              <Box flex={1}>
                <strong>{formatStorePrice2Read(userInfo?.team?.balance).toFixed(3)}</strong>{' '}
                {t('account_info:yuan')}
              </Box>

              {userInfo?.permission.hasManagePer && !!standardPlan && (
                <Button variant={'primary'} size={'sm'} ml={5} onClick={onOpenConversionModal}>
                  {t('account_info:exchange')}
                </Button>
              )}
            </Flex>
          </Box>
        )}

        {/* 聊天问题配置 */}
        <MyDivider my={6} />

        {isPc && (
          <Flex alignItems={'center'} h={'30px'} {...titleStyles} mt={6}>
            <MyIcon mr={2} name={'core/chat/chatModelTag'} w={'1.25rem'} />
            聊天问题配置
          </Flex>
        )}

        <Box mt={6}>
          <Flex alignItems={'flex-start'}>
            <Box {...labelStyles} pt={2}>
              聊天问题内容：
            </Box>
            <Box flex={1}>
              {isEditingChatProblem ? (
                <VStack spacing={3} align="stretch">
                  {/* Markdown 工具栏 */}
                  <Box>
                    <Text fontSize="sm" color="gray.600" mb={2}>
                      Markdown 工具栏：
                    </Text>
                    <ButtonGroup size="xs" spacing={1} flexWrap="wrap">
                      <Tooltip label="粗体">
                        <IconButton
                          aria-label="粗体"
                          icon={<Text fontWeight="bold">B</Text>}
                          onClick={() => insertMarkdown('**{text}**', '粗体文本')}
                        />
                      </Tooltip>
                      <Tooltip label="斜体">
                        <IconButton
                          aria-label="斜体"
                          icon={<Text fontStyle="italic">I</Text>}
                          onClick={() => insertMarkdown('*{text}*', '斜体文本')}
                        />
                      </Tooltip>
                      <Tooltip label="标题">
                        <IconButton
                          aria-label="标题"
                          icon={<Text>H</Text>}
                          onClick={() => insertMarkdown('# {text}', '标题')}
                        />
                      </Tooltip>
                      <Tooltip label="链接">
                        <IconButton
                          aria-label="链接"
                          icon={<MyIcon name="common/linkBlue" />}
                          onClick={() => insertMarkdown('[{text}](URL)', '链接文本')}
                        />
                      </Tooltip>
                      <Tooltip label="插入图片">
                        <IconButton
                          aria-label="插入图片"
                          icon={<Text>🖼️</Text>}
                          onClick={() => insertMarkdown('![{text}](图片URL)', '图片描述')}
                        />
                      </Tooltip>
                      <Tooltip label="上传图片">
                        <IconButton
                          as="label"
                          aria-label="上传图片"
                          icon={<Text>📤</Text>}
                          isLoading={isUploadingImage}
                          cursor="pointer"
                        >
                          <Input
                            type="file"
                            accept="image/*"
                            display="none"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleImageUpload(file);
                              }
                            }}
                          />
                        </IconButton>
                      </Tooltip>
                      <Tooltip label="代码块">
                        <IconButton
                          aria-label="代码块"
                          icon={<Text fontFamily="mono">{`</>`}</Text>}
                          onClick={() => insertMarkdown('```\n{text}\n```', '代码')}
                        />
                      </Tooltip>
                      <Tooltip label="列表">
                        <IconButton
                          aria-label="列表"
                          icon={<Text>📋</Text>}
                          onClick={() => insertMarkdown('- {text}', '列表项')}
                        />
                      </Tooltip>
                      <Tooltip label={showPreview ? '隐藏预览' : '显示预览'}>
                        <IconButton
                          aria-label="预览"
                          icon={<Text>{showPreview ? '🙈' : '👁️'}</Text>}
                          onClick={() => setShowPreview(!showPreview)}
                          colorScheme={showPreview ? 'blue' : 'gray'}
                        />
                      </Tooltip>
                    </ButtonGroup>
                  </Box>

                  {/* 编辑器和预览 */}
                  <HStack spacing={4} align="stretch">
                    {/* 编辑器 */}
                    <Box
                      flex={showPreview ? '1' : '1'}
                      border="1px solid"
                      borderColor="gray.200"
                      borderRadius="md"
                      position="relative"
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      _hover={{ borderColor: 'blue.300' }}
                    >
                      <Textarea
                        value={chatProblemContent}
                        onChange={(e) => setChatProblemContent(e.target.value)}
                        placeholder="请输入聊天问题的 Markdown 内容...

支持的功能：
- 拖拽图片到此处上传
- 使用工具栏快速插入 Markdown 语法
- 支持标题、粗体、斜体、链接、图片、代码块等

示例：
# 标题
**粗体文本**
*斜体文本*
![图片](图片URL)
[链接文本](链接URL)"
                        rows={12}
                        resize="vertical"
                        border="none"
                        _focus={{ boxShadow: 'none' }}
                      />
                      {isUploadingImage && (
                        <Box
                          position="absolute"
                          top="50%"
                          left="50%"
                          transform="translate(-50%, -50%)"
                          bg="rgba(255,255,255,0.9)"
                          p={4}
                          borderRadius="md"
                          display="flex"
                          alignItems="center"
                          gap={2}
                        >
                          <Spinner size="sm" />
                          <Text>正在上传图片...</Text>
                        </Box>
                      )}
                    </Box>

                    {/* 预览面板 */}
                    {showPreview && (
                      <Box
                        flex="1"
                        border="1px solid"
                        borderColor="gray.200"
                        borderRadius="md"
                        p={4}
                        maxH="400px"
                        overflowY="auto"
                        bg="gray.50"
                      >
                        <Box mb={2} pb={2} borderBottom="1px solid" borderColor="gray.300">
                          <Text fontSize="sm" fontWeight="bold" color="gray.600">
                            📝 实时预览
                          </Text>
                        </Box>
                        {chatProblemContent ? (
                          <Markdown source={chatProblemContent} />
                        ) : (
                          <Text color="gray.400" fontStyle="italic">
                            在左侧编辑器中输入内容，这里将显示实时预览...
                          </Text>
                        )}
                      </Box>
                    )}
                  </HStack>

                  {/* 操作按钮 */}
                  <HStack justify="space-between">
                    <Text fontSize="xs" color="gray.500">
                      💡 提示：可以直接拖拽图片到编辑器中上传
                    </Text>
                    <HStack>
                      <Button size="sm" colorScheme="blue" onClick={handleSaveChatProblem}>
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setIsEditingChatProblem(false);
                          setChatProblemContent(userInfo?.chatProblem || '');
                        }}
                      >
                        取消
                      </Button>
                    </HStack>
                  </HStack>
                </VStack>
              ) : (
                <Box>
                  <Text color="gray.600" mb={2}>
                    {chatProblemContent ? '已自定义' : '使用系统默认内容'}
                  </Text>
                  <Button size="sm" variant="outline" onClick={() => setIsEditingChatProblem(true)}>
                    {chatProblemContent ? '编辑' : '自定义'}
                  </Button>
                </Box>
              )}
            </Box>
          </Flex>
        </Box>

        {/* Root用户专用：用户列表管理 */}
        {isRoot && (
          <>
            <MyDivider my={6} />
            {isPc && (
              <Flex alignItems={'center'} h={'30px'} {...titleStyles} mt={6}>
                <MyIcon mr={2} name={'support/user/usersLight'} w={'1.25rem'} />
                用户管理
              </Flex>
            )}
            <Box mt={6}>
              <Box {...labelStyles} mb={3}>
                用户管理 (共 {totalUsers} 个用户)
              </Box>

              {/* 搜索区域 */}
              <HStack mb={4} spacing={2}>
                <Select
                  value={searchType}
                  onChange={(e) => setSearchType(e.target.value as 'username' | 'accessKey')}
                  w={'120px'}
                  size={'sm'}
                >
                  <option value="username">用户名</option>
                  <option value="accessKey">AccessKey</option>
                </Select>
                <Input
                  placeholder={searchType === 'accessKey' ? '精确搜索AccessKey' : '模糊搜索用户名'}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  size={'sm'}
                  flex={1}
                />
                <Button size={'sm'} variant={'outline'} onClick={handleResetSearch}>
                  清空
                </Button>
              </HStack>

              {/* 用户列表 */}
              <Box
                minH={'300px'}
                border={'1px solid'}
                borderColor={'myGray.200'}
                borderRadius={'md'}
                p={2}
                position={'relative'}
              >
                {loadingUsers && (
                  <Flex justifyContent={'center'} alignItems={'center'} h={'200px'}>
                    <Spinner size={'md'} />
                  </Flex>
                )}

                {!loadingUsers &&
                  allUsers.map((user) => (
                    <Flex
                      key={user._id}
                      alignItems={'center'}
                      p={2}
                      mb={1}
                      borderRadius={'md'}
                      cursor={user.username !== userInfo?.username ? 'pointer' : 'default'}
                      bg={user.username === userInfo?.username ? 'blue.50' : 'transparent'}
                      _hover={user.username !== userInfo?.username ? { bg: 'myGray.50' } : {}}
                      onClick={() => {
                        if (user.username !== userInfo?.username) {
                          handleSwitchUser(user._id);
                        }
                      }}
                    >
                      <Avatar src={user.avatar} w={'24px'} h={'24px'} mr={2} />
                      <Box flex={1}>
                        <Box
                          fontSize={'sm'}
                          fontWeight={user.username === userInfo?.username ? 'bold' : 'normal'}
                        >
                          {user.username}
                          {user.username === userInfo?.username && (
                            <Box as="span" color={'blue.500'} ml={2} fontSize={'xs'}>
                              (当前用户)
                            </Box>
                          )}
                        </Box>
                        <Box fontSize={'xs'} color={'myGray.500'}>
                          状态: {user.status === 'active' ? '正常' : '禁用'} | 创建时间:{' '}
                          {new Date(user.createTime).toLocaleDateString()}
                          {user.accessKey && (
                            <Text as="span" ml={2}>
                              | AccessKey: {user.accessKey.slice(0, 8)}...
                            </Text>
                          )}
                        </Box>
                      </Box>
                      {user.username !== userInfo?.username && (
                        <MyIcon name={'common/rightArrowLight'} w={'12px'} color={'myGray.400'} />
                      )}
                    </Flex>
                  ))}

                {!loadingUsers && allUsers.length === 0 && (
                  <Flex
                    justifyContent={'center'}
                    alignItems={'center'}
                    h={'200px'}
                    color={'myGray.500'}
                    flexDirection={'column'}
                  >
                    <Text>{searchText ? '未找到匹配的用户' : '暂无用户数据'}</Text>
                    {searchText && (
                      <Button size={'sm'} variant={'ghost'} mt={2} onClick={handleResetSearch}>
                        清除搜索条件
                      </Button>
                    )}
                  </Flex>
                )}
              </Box>

              {/* 分页组件 */}
              {!loadingUsers && totalPages > 1 && (
                <Flex justifyContent={'center'} alignItems={'center'} mt={4} gap={2}>
                  <Button
                    size={'sm'}
                    variant={'outline'}
                    leftIcon={<ArrowBackIcon />}
                    isDisabled={currentPage === 1}
                    onClick={() => setCurrentPage(currentPage - 1)}
                  >
                    上一页
                  </Button>

                  <HStack spacing={1}>
                    <Text fontSize={'sm'}>第</Text>
                    <Input
                      value={currentPage}
                      onChange={(e) => {
                        const page = parseInt(e.target.value);
                        if (page >= 1 && page <= totalPages) {
                          setCurrentPage(page);
                        }
                      }}
                      w={'60px'}
                      h={'32px'}
                      size={'sm'}
                      textAlign={'center'}
                    />
                    <Text fontSize={'sm'}>/ {totalPages} 页</Text>
                  </HStack>

                  <Button
                    size={'sm'}
                    variant={'outline'}
                    rightIcon={<ArrowForwardIcon />}
                    isDisabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(currentPage + 1)}
                  >
                    下一页
                  </Button>

                  <Text fontSize={'sm'} color={'gray.500'}>
                    共 {totalUsers} 条
                  </Text>
                </Flex>
              )}
            </Box>
          </>
        )}

        <MyDivider my={6} />
      </Box>
      {isOpenConversionModal && (
        <ConversionModal onClose={onCloseConversionModal} onOpenContact={onOpenContact} />
      )}
      {isOpenUpdatePsw && <UpdatePswModal onClose={onCloseUpdatePsw} />}
      {isOpenUpdateContact && <UpdateContact onClose={onCloseUpdateContact} mode="contact" />}
      <File
        onSelect={(e) =>
          onSelectImage(e, {
            maxW: 300,
            maxH: 300,
            callback: (src) => {
              if (!userInfo) return;
              onclickSave({
                ...userInfo,
                avatar: src
              });
            }
          })
        }
      />
    </Box>
  );
};

const PlanUsage = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const { userInfo, initUserInfo, teamPlanStatus, initTeamPlanStatus } = useUserStore();
  const { subPlans, feConfigs } = useSystemStore();
  const { reset } = useForm<UserUpdateParams>({
    defaultValues: userInfo as UserType
  });

  const {
    isOpen: isOpenStandardModal,
    onClose: onCloseStandardModal,
    onOpen: onOpenStandardModal
  } = useDisclosure();

  const {
    isOpen: isOpenRedeemCouponModal,
    onClose: onCloseRedeemCouponModal,
    onOpen: onOpenRedeemCouponModal
  } = useDisclosure();

  const planName = useMemo(() => {
    if (!teamPlanStatus?.standard?.currentSubLevel) return '';
    return standardSubLevelMap[teamPlanStatus.standard.currentSubLevel].label;
  }, [teamPlanStatus?.standard?.currentSubLevel]);
  const standardPlan = teamPlanStatus?.standard;
  const isFreeTeam = useMemo(() => {
    if (!teamPlanStatus || !teamPlanStatus?.standardConstants) return false;
    const hasExtraDatasetSize =
      teamPlanStatus.datasetMaxSize > teamPlanStatus.standardConstants.maxDatasetSize;
    const hasExtraPoints =
      teamPlanStatus.totalPoints > teamPlanStatus.standardConstants.totalPoints;
    if (
      teamPlanStatus?.standard?.currentSubLevel === StandardSubLevelEnum.free &&
      !hasExtraDatasetSize &&
      !hasExtraPoints
    ) {
      return true;
    }
    return false;
  }, [teamPlanStatus]);

  useQuery(['init'], initUserInfo, {
    onSuccess(res) {
      reset(res);
    }
  });

  const valueColorSchema = useCallback((val: number) => {
    if (val < 50) return 'green';
    if (val < 80) return 'yellow';
    return 'red';
  }, []);

  const datasetIndexUsageMap = useMemo(() => {
    if (!teamPlanStatus) {
      return {
        value: 0,
        max: t('account_info:unlimited'),
        rate: 0
      };
    }
    const rate = teamPlanStatus.usedDatasetIndexSize / teamPlanStatus.datasetMaxSize;

    return {
      value: teamPlanStatus.usedDatasetIndexSize,
      rate: rate * 100,
      max: teamPlanStatus.datasetMaxSize || 1
    };
  }, [t, teamPlanStatus]);
  const aiPointsUsageMap = useMemo(() => {
    if (!teamPlanStatus) {
      return {
        value: 0,
        max: t('account_info:unlimited'),
        rate: 0
      };
    }

    return {
      value: Math.round(teamPlanStatus.usedPoints),
      max: teamPlanStatus.totalPoints,
      rate: (teamPlanStatus.usedPoints / teamPlanStatus.totalPoints) * 100
    };
  }, [t, teamPlanStatus]);

  const limitData = useMemo(() => {
    if (!teamPlanStatus) {
      return [];
    }

    return [
      {
        label: t('account_info:member_amount'),
        value: teamPlanStatus.usedMember,
        max: teamPlanStatus?.standardConstants?.maxTeamMember || t('account_info:unlimited'),
        rate:
          (teamPlanStatus.usedMember / (teamPlanStatus?.standardConstants?.maxTeamMember || 1)) *
          100
      },
      {
        label: t('account_info:app_amount'),
        value: teamPlanStatus.usedAppAmount,
        max: teamPlanStatus?.standardConstants?.maxAppAmount || t('account_info:unlimited'),
        rate:
          (teamPlanStatus.usedAppAmount / (teamPlanStatus?.standardConstants?.maxAppAmount || 1)) *
          100
      },
      {
        label: t('account_info:dataset_amount'),
        value: teamPlanStatus.usedDatasetSize,
        max: teamPlanStatus?.standardConstants?.maxDatasetAmount || t('account_info:unlimited'),
        rate:
          (teamPlanStatus.usedDatasetSize /
            (teamPlanStatus?.standardConstants?.maxDatasetAmount || 1)) *
          100
      }
    ];
  }, [t, teamPlanStatus]);

  return standardPlan ? (
    <Box mt={[6, 0]}>
      <Flex fontSize={['md', 'lg']} h={'30px'}>
        <Flex
          alignItems={'center'}
          color="var(--light-general-on-surface, var(--Gray-Modern-900, #111824))"
          fontFamily='"PingFang SC"'
          fontSize="16px"
          fontStyle="normal"
          fontWeight={500}
          lineHeight="24px"
          letterSpacing="0.15px"
        >
          <MyIcon mr={2} name={'support/account/plans'} w={'20px'} />
          {t('account_info:package_and_usage')}
        </Flex>
        <ModelPriceModal>
          {({ onOpen }) => (
            <Button ml={3} size={'sm'} onClick={onOpen}>
              {t('account_info:billing_standard')}
            </Button>
          )}
        </ModelPriceModal>
        <Button ml={3} variant={'whitePrimary'} size={'sm'} onClick={onOpenStandardModal}>
          {t('account_info:package_details')}
        </Button>
        {userInfo?.permission.isOwner && feConfigs?.show_coupon && (
          <Button ml={3} variant={'whitePrimary'} size={'sm'} onClick={onOpenRedeemCouponModal}>
            {t('account_info:redeem_coupon')}
          </Button>
        )}
      </Flex>
      <Box
        mt={[3, 6]}
        bg={'white'}
        borderWidth={'1px'}
        borderColor={'borderColor.low'}
        borderRadius={'md'}
      >
        <Flex px={[5, 7]} pt={[3, 6]}>
          <Box flex={'1 0 0'}>
            <Box color={'myGray.600'} fontSize="sm">
              {t('account_info:current_package')}
            </Box>
            <Box fontWeight={'bold'} fontSize="lg">
              {t(planName as any)}
            </Box>
          </Box>
          <Button
            onClick={() => {
              router.push(
                subPlans?.planDescriptionUrl ? getDocPath(subPlans.planDescriptionUrl) : '/price'
              );
            }}
            w={'8rem'}
            size="sm"
          >
            {t('account_info:upgrade_package')}
          </Button>
        </Flex>
        <Box px={[5, 7]} pb={[3, 6]}>
          {isFreeTeam && (
            <Box mt="2" color={'#485264'} fontSize="sm">
              {t('account_info:account_knowledge_base_cleanup_warning')}
            </Box>
          )}
          {standardPlan.currentSubLevel !== StandardSubLevelEnum.free && (
            <Flex mt="2" color={'#485264'} fontSize="xs">
              <Box>{t('account_info:package_expiry_time')}:</Box>
              <Box ml={2}>{formatTime2YMD(standardPlan?.expiredTime)}</Box>
            </Flex>
          )}
        </Box>

        <Box py={3} borderTopWidth={'1px'} borderTopColor={'borderColor.base'}>
          <Box py={[0, 3]} px={[5, 7]} overflow={'auto'}>
            <StandardPlanContentList
              level={standardPlan?.currentSubLevel}
              mode={standardPlan.currentMode}
              standplan={standardPlan}
            />
          </Box>
        </Box>
      </Box>
      <Box
        mt={6}
        bg={'white'}
        borderWidth={'1px'}
        borderColor={'borderColor.low'}
        borderRadius={'md'}
        px={[5, 10]}
        pt={4}
        pb={[4, 7]}
      >
        <Flex>
          <Flex flex={'1 0 0'} alignItems={'flex-end'}>
            <Box fontSize={'md'} fontWeight={'bold'} color={'myGray.900'}>
              {t('account_info:resource_usage')}
            </Box>
            <Box ml={1} display={['none', 'block']} fontSize={'xs'} color={'myGray.500'}>
              {t('account_info:standard_package_and_extra_resource_package')}
            </Box>
          </Flex>
          <Link
            href={getWebReqUrl(getExtraPlanCardRoute())}
            transform={'translateX(15px)'}
            display={'flex'}
            alignItems={'center'}
            color={'primary.600'}
            cursor={'pointer'}
            fontSize={'sm'}
          >
            {t('account_info:purchase_extra_package')}
            <MyIcon ml={1} name={'common/rightArrowLight'} w={'12px'} />
          </Link>
        </Flex>
        <Box width={'100%'} mt={5} fontSize={'sm'}>
          <Flex alignItems={'center'}>
            <Flex alignItems={'center'}>
              <Box fontWeight={'bold'} color={'myGray.900'}>
                {t('account_info:knowledge_base_capacity')}
              </Box>
              <Box color={'myGray.600'} ml={2}>
                {datasetIndexUsageMap.value}/{datasetIndexUsageMap.max}
              </Box>
            </Flex>
          </Flex>
          <Box mt={1}>
            <Progress
              size={'sm'}
              value={datasetIndexUsageMap.rate}
              colorScheme={valueColorSchema(datasetIndexUsageMap.rate)}
              borderRadius={'md'}
              isAnimated
              hasStripe
              borderWidth={'1px'}
              borderColor={'borderColor.low'}
            />
          </Box>
        </Box>
        <Box mt="6" width={'100%'} fontSize={'sm'}>
          <Flex alignItems={'center'}>
            <Flex alignItems={'center'}>
              <Box fontWeight={'bold'} color={'myGray.900'}>
                {t('account_info:ai_points_usage')}
              </Box>
              <QuestionTip ml={1} label={t('account_info:ai_points_usage_tip')}></QuestionTip>
              <Box color={'myGray.600'} ml={2}>
                {aiPointsUsageMap.value}/{aiPointsUsageMap.max}
              </Box>
            </Flex>
          </Flex>
          <Box mt={1}>
            <Progress
              size={'sm'}
              value={aiPointsUsageMap.rate}
              colorScheme={valueColorSchema(aiPointsUsageMap.rate)}
              borderRadius={'md'}
              isAnimated
              hasStripe
              borderWidth={'1px'}
              borderColor={'borderColor.low'}
            />
          </Box>
        </Box>

        <MyDivider />

        {limitData.map((item) => {
          return (
            <Box
              key={item.label}
              _notFirst={{
                mt: 4
              }}
              width={'100%'}
              fontSize={'sm'}
            >
              <Flex alignItems={'center'}>
                <Box fontWeight={'bold'} color={'myGray.900'}>
                  {item.label}
                </Box>
                <Box color={'myGray.600'} ml={2}>
                  {item.value}/{item.max}
                </Box>
              </Flex>
              <Box mt={1}>
                <Progress
                  size={'sm'}
                  value={item.rate}
                  colorScheme={valueColorSchema(item.rate)}
                  borderRadius={'md'}
                  isAnimated
                  hasStripe
                  borderWidth={'1px'}
                  borderColor={'borderColor.low'}
                />
              </Box>
            </Box>
          );
        })}
      </Box>
      {isOpenStandardModal && <StandDetailModal onClose={onCloseStandardModal} />}
      {isOpenRedeemCouponModal && (
        <RedeemCouponModal
          onClose={onCloseRedeemCouponModal}
          onSuccess={() => initTeamPlanStatus()}
        />
      )}
    </Box>
  ) : null;
};

const ButtonStyles = {
  bg: 'white',
  py: 3,
  px: 6,
  border: 'sm',
  borderWidth: '1.5px',
  borderRadius: 'md',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  userSelect: 'none' as any,
  fontSize: 'sm'
};
const Other = ({ onOpenContact }: { onOpenContact: () => void }) => {
  const { feConfigs } = useSystemStore();
  const { teamPlanStatus } = useUserStore();
  const { t } = useTranslation();
  const { isPc } = useSystem();

  const { runAsync: onFeedback } = useRequest2(getWorkorderURL, {
    manual: true,
    onSuccess(data) {
      if (data) {
        window.open(data.redirectUrl);
      }
    }
  });

  return (
    <Box>
      <Grid gridGap={4}>
        {feConfigs?.docUrl && (
          <Link
            href={getDocPath('/docs/intro')}
            target="_blank"
            textDecoration={'none !important'}
            {...ButtonStyles}
          >
            <MyIcon name={'common/courseLight'} w={'18px'} color={'myGray.600'} />
            <Box ml={2} flex={1}>
              {t('account_info:help_document')}
            </Box>
          </Link>
        )}

        {!isPc &&
          feConfigs?.navbarItems
            ?.filter((item) => item.isActive)
            .map((item) => (
              <Flex key={item.id} {...ButtonStyles} onClick={() => window.open(item.url, '_blank')}>
                <Avatar src={item.avatar} w={'18px'} />
                <Box ml={2} flex={1}>
                  {item.name}
                </Box>
              </Flex>
            ))}
        {feConfigs?.concatMd && (
          <Flex onClick={onOpenContact} {...ButtonStyles}>
            <MyIcon name={'modal/concat'} w={'18px'} color={'myGray.600'} />
            <Box ml={2} flex={1}>
              {t('account_info:contact_us')}
            </Box>
          </Flex>
        )}
        {feConfigs?.show_workorder &&
          teamPlanStatus &&
          teamPlanStatus.standard?.currentSubLevel !== StandardSubLevelEnum.free && (
            <Flex onClick={onFeedback} {...ButtonStyles}>
              <MyIcon name={'feedback'} w={'18px'} color={'myGray.600'} />
              <Box ml={2} flex={1}>
                {t('common:question_feedback')}
              </Box>
            </Flex>
          )}
      </Grid>
    </Box>
  );
};
