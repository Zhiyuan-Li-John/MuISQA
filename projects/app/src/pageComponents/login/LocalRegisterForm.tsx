import React, { type Dispatch } from 'react';
import { FormControl, Box, Input, Button } from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import { LoginPageTypeEnum } from '@/web/support/user/login/constants';
import { postLocalRegister } from '@/web/support/user/api';
import type { ResLogin } from '@/global/support/api/userRes';
import { useToast } from '@fastgpt/web/hooks/useToast';
import { useTranslation } from 'next-i18next';
import { useRequest2 } from '@fastgpt/web/hooks/useRequest';
import { checkPasswordRule } from '@fastgpt/global/common/string/password';
import FormLayout from './LoginForm/FormLayout';

interface Props {
  loginSuccess: (e: ResLogin) => void;
  setPageType: Dispatch<`${LoginPageTypeEnum}`>;
}

type LocalRegisterType = {
  username: string;
  password: string;
  password2: string;
};

const LocalRegisterForm = ({ setPageType, loginSuccess }: Props) => {
  const { toast } = useToast();
  const { t } = useTranslation();

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors }
  } = useForm<LocalRegisterType>({
    mode: 'onBlur'
  });

  const { runAsync: onclickRegister, loading: requesting } = useRequest2(
    async ({ username, password }: LocalRegisterType) => {
      const result = await postLocalRegister({
        username,
        password
      });

      loginSuccess(result);

      toast({
        status: 'success',
        title: '注册成功！'
      });
    },
    {
      refreshDeps: [loginSuccess, toast]
    }
  );

  const onSubmitErr = (err: Record<string, any>) => {
    const val = Object.values(err)[0];
    if (!val) return;
    if (val.message) {
      toast({
        status: 'warning',
        title: val.message,
        duration: 3000,
        isClosable: true
      });
    }
  };

  return (
    <FormLayout setPageType={setPageType} pageType={LoginPageTypeEnum.localRegister}>
      <Box fontWeight={'medium'} fontSize={'lg'} textAlign={'center'} color={'myGray.900'}>
        注册新账户
      </Box>
      <Box
        mt={9}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !requesting) {
            handleSubmit(onclickRegister, onSubmitErr)();
          }
        }}
      >
        <FormControl isInvalid={!!errors.username}>
          <Input
            bg={'myGray.50'}
            size={'lg'}
            placeholder="用户名"
            {...register('username', {
              required: '请输入用户名',
              minLength: {
                value: 3,
                message: '用户名至少3个字符'
              }
            })}
          />
        </FormControl>

        <FormControl mt={6} isInvalid={!!errors.password}>
          <Input
            bg={'myGray.50'}
            size={'lg'}
            type={'password'}
            placeholder="密码（至少8位，包含字母和数字）"
            {...register('password', {
              required: '请输入密码',
              validate: (val) => {
                if (!checkPasswordRule(val)) {
                  return '密码至少8位，包含字母和数字';
                }
                return true;
              }
            })}
          />
        </FormControl>

        <FormControl mt={6} isInvalid={!!errors.password2}>
          <Input
            bg={'myGray.50'}
            size={'lg'}
            type={'password'}
            placeholder="确认密码"
            {...register('password2', {
              validate: (val) => (getValues('password') === val ? true : '两次输入的密码不一致')
            })}
          />
        </FormControl>

        <Button
          type="submit"
          mt={12}
          w={'100%'}
          size={['md', 'md']}
          rounded={['md', 'md']}
          h={[10, 10]}
          fontWeight={['medium', 'medium']}
          colorScheme="blue"
          isLoading={requesting}
          onClick={handleSubmit(onclickRegister, onSubmitErr)}
        >
          注册
        </Button>

        <Box
          float={'right'}
          fontSize="mini"
          mt={3}
          mb={'50px'}
          fontWeight={'medium'}
          color={'primary.700'}
          cursor={'pointer'}
          _hover={{ textDecoration: 'underline' }}
          onClick={() => setPageType(LoginPageTypeEnum.passwordLogin)}
        >
          返回登录
        </Box>
      </Box>
    </FormLayout>
  );
};

export default LocalRegisterForm;
