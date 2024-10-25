'use client'

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid'

export function HomePage() {
    const [topics, setTopics] = useState<{ title: string; uuid: string }[]>([]);
    const [newTopic, setNewTopic] = useState('');
    const [showInput, setShowInput] = useState(false);
    const navigate = useNavigate();
    const [isAdding, setIsAdding] = useState(false);

    useEffect(() => {
        const storedTopics = JSON.parse(localStorage.getItem('topics') || '[]') || [];
        setTopics(storedTopics);
    }, []);

    const handleAddTopic = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (newTopic.trim() === '') return;
        const newTopicItem = { title: newTopic, uuid: uuidv4() };
        const updatedTopics = [...topics, newTopicItem];
        setTopics(updatedTopics);
        localStorage.setItem('topics', JSON.stringify(updatedTopics));
        setNewTopic('');
        setShowInput(false);
    };

    const handleTopicClick = (uuid: string) => {
        navigate(`/study?uuid=${uuid}`);
    };

    return (
        <div className="container mx-auto px-4 py-8 flex flex-col items-center">
            <h1 className="text-3xl font-bold mb-6 text-center">Learning Topics</h1>

            <ul className="space-y-2 mb-4 w-full">
                {topics.map((topic) => (
                    <li
                        key={topic.uuid}
                        className="bg-white p-3 rounded shadow cursor-pointer hover:underline"
                        onClick={() => handleTopicClick(topic.uuid)}
                    >
                        {topic.title}
                    </li>
                ))}
            </ul>

            {!isAdding ? (
                <button
                    onClick={() => setIsAdding(true)}
                    className="w-full bg-black text-white font-bold py-2 px-4 rounded cursor-pointer"
                >
                    Add New Topic
                </button>
            ) : (
                <form onSubmit={handleAddTopic} className="space-y-2 w-full">
                    <input
                        type="text"
                        value={newTopic}
                        onChange={(e) => setNewTopic(e.target.value)}
                        placeholder="Enter new topic"
                        className="w-full p-2 border border-gray-300 rounded"
                    />
                    <div className="flex space-x-2">
                        <button
                            type="submit"
                            className="flex-1 bg-black text-white font-bold py-2 px-4 rounded"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => setIsAdding(false)}
                            className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}
        </div>
    )
}