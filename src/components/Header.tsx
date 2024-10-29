import { useCallback } from 'react';
import { Button } from './button/Button';
import { Edit } from 'react-feather';
import { useLocalStorage } from '../utils/local_storage_hook';

export const Header = ({ title, onNavigateBack }: {
    title: string;
    onNavigateBack: () => void;
}) => {

    const [apiKey, setApiKey] = useLocalStorage<string>('tmp::voice_api_key', '',);
    const [tavilyApiKey, setTavilyApiKey] = useLocalStorage<string>('tmp::tvly_api_key', '');

    /**
     * When you click the API key
     */
    const resetAPIKey = useCallback(() => {
        const newApiKey = prompt('OpenAI API Key');
        if (newApiKey !== null) {
            setApiKey(newApiKey);
            window.location.reload();
        }
    }, []);

    const resetTavilyApiKey = useCallback(() => {
        const newApiKey = prompt('Tavily API Key');
        if (newApiKey !== null) {
            setTavilyApiKey(newApiKey);
            window.location.reload();
        }
    }, []);

    return <div className="items-center p-2 px-4 min-h-[40px] fixed top-0 left-0 right-0 bg-white z-50 border-b border-gray-300 flex-grow flex mx-4 overflow-hidden mb-6">
        <div className="flex-grow flex items-center gap-3 cursor-pointer" onClick={onNavigateBack}>
            <img src="/openai-logomark.svg" alt="" className="w-6 h-6" />
            {window.innerWidth > 768 && <span className='text-lg line-clamp-1'>{title ?? 'Learning Dashboard'}</span>}
        </div>
        <div>
            <Button
                icon={Edit}
                iconPosition="end"
                buttonStyle="flush"
                label={`OpenAI: ${apiKey.slice(0, 3)}...`}
                onClick={() => resetAPIKey()}
            />
        </div>
        <div>
            <Button
                icon={Edit}
                iconPosition="end"
                buttonStyle="flush"
                label={`Tavily: ${tavilyApiKey.slice(0, 3)}...`}
                onClick={() => resetTavilyApiKey()}
            />
        </div>
    </div>;
};

export default Header;