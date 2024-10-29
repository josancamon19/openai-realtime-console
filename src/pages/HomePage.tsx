'use client'

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocalStorage } from '../utils/local_storage_hook'
import Header from '../components/Header';

export function HomePage() {
    const [topics, setTopics] = useLocalStorage<{ title: string; uuid: string }[]>('topics', []);
    const [newTopic, setNewTopic] = useState('');
    const [showInput, setShowInput] = useState(false);
    const navigate = useNavigate();
    const [isAdding, setIsAdding] = useState(false);
    const [name, setName] = useLocalStorage<string>('userName', '');
    const [showNameModal, setShowNameModal] = useState(false);
    const [showCelebration, setShowCelebration] = useState(false);

    useEffect(() => {
        if (!name) {
            setShowNameModal(true);
        }
    }, [name]);

    const handleNameSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (name.trim()) {
            setName(name);
            setShowNameModal(false);
            setShowCelebration(true);
            setTimeout(() => setShowCelebration(false), 3000);
        }
    };

    const handleAddTopic = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (newTopic.trim() === '') return;
        const newTopicItem = { title: newTopic, uuid: uuidv4() };
        const updatedTopics = [...topics, newTopicItem];
        setTopics(updatedTopics);
        setNewTopic('');
        setShowInput(false);
    };

    const handleTopicClick = (uuid: string) => {
        navigate(`/study?uuid=${uuid}`);
    };

    const handleDeleteTopic = (uuid: string) => {
        if (window.confirm('Are you sure you want to delete this topic?')) {
            const updatedTopics = topics.filter(t => t.uuid !== uuid);
            setTopics(updatedTopics);
            localStorage.removeItem(`${uuid}::mermaidGraph`);
            localStorage.removeItem(`${uuid}::messageHistory`);
        }
    };

    return (
        <div className="container mx-auto px-4 py-8 flex flex-col items-center relative overflow-hidden">
            <Header
                title={'Learning Dashboard'}
                onNavigateBack={() => navigate('/')}
            />
            <AnimatePresence>
                {showNameModal && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                    >
                        <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
                            <h2 className="text-2xl font-bold mb-4 text-center">Welcome! 👋</h2>
                            <p className="text-gray-600 mb-6 text-center">Please tell us your name to get started</p>
                            <form onSubmit={handleNameSubmit} className="space-y-4">
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Enter your name"
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    autoFocus
                                />
                                <button
                                    type="submit"
                                    className="w-full bg-black hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                                >
                                    Let's Begin!
                                </button>
                            </form>
                        </div>
                    </motion.div>
                )}

                {showCelebration && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -50 }}
                        className="fixed top-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg mt-16"
                    >
                        <p className="text-lg">🎉 Welcome aboard, {name}! 🎊</p>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="text-center mt-16">
                <h1 className="text-3xl font-bold mb-2">
                    {name && `Hello, ${name}!`}
                </h1>
                <h2 className="text-2xl mb-6">
                    {name ? 'What would you like to learn today?' : 'Learning Topics'}
                </h2>
            </div>

            <div className="max-w-md w-full">
                {topics.length === 0 ? (
                    <div className="text-center py-12 px-4">
                        <div className="text-6xl mb-4">🤔</div>
                        <h3 className="text-xl font-semibold mb-2">No topics yet</h3>
                        <p className="text-gray-600 mb-8">Create your first learning topic to get started!</p>
                    </div>
                ) : (
                    <ul className="space-y-2 mb-4">
                        {topics.map((topic) => (
                            <li
                                key={topic.uuid}
                                className="bg-white p-3 rounded shadow flex justify-between items-center group"
                            >
                                <span
                                    className="cursor-pointer hover:underline"
                                    onClick={() => handleTopicClick(topic.uuid)}
                                >
                                    {topic.title}
                                </span>
                                <button
                                    className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteTopic(topic.uuid);
                                    }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {!isAdding ? (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="w-full bg-black hover:bg-blue-600 text-white font-bold py-2 px-4 rounded cursor-pointer transition-colors"
                    >
                        Add New Topic
                    </button>
                ) : (
                    <form onSubmit={handleAddTopic} className="space-y-2">
                        <input
                            type="text"
                            value={newTopic}
                            onChange={(e) => setNewTopic(e.target.value)}
                            placeholder="Enter new topic"
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            autoFocus
                        />
                        <div className="flex space-x-2">
                            <button
                                type="submit"
                                className="flex-1 bg-black hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition-colors"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => setIsAdding(false)}
                                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}