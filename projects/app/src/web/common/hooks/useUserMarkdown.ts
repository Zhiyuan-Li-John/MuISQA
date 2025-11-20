import { useEffect, useState } from 'react';
import { useUserStore } from '@/web/support/user/useUserStore';
import type { UserType } from '@fastgpt/global/support/user/type.d';

export const useUserMarkdown = ({
  url,
  userField
}: {
  url: string;
  userField?: keyof UserType;
}) => {
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(false);
  const { userInfo } = useUserStore();

  const loadMarkdown = async () => {
    setLoading(true);
    try {
      // 优先使用用户自定义内容
      if (userField && userInfo && userField in userInfo && userInfo[userField]) {
        setData(userInfo[userField] as string);
        setLoading(false);
        return;
      }

      // 回退到默认文件
      const response = await fetch(url);
      if (response.ok) {
        const content = await response.text();
        setData(content);
      } else {
        setData('');
      }
    } catch (error) {
      console.error('Failed to load markdown:', error);
      setData('');
    } finally {
      setLoading(false);
    }
  };

  // 创建依赖数组，确保类型安全
  const userFieldValue = userField && userInfo ? userInfo[userField] : null;

  useEffect(() => {
    loadMarkdown();
  }, [url, userFieldValue]);

  // 监听用户配置更新事件
  useEffect(() => {
    const handleChatProblemUpdate = () => {
      loadMarkdown();
    };

    window.addEventListener('chatProblemUpdated', handleChatProblemUpdate);
    return () => {
      window.removeEventListener('chatProblemUpdated', handleChatProblemUpdate);
    };
  }, []);

  return { data, loading };
};
