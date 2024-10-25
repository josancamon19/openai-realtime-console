import React, { useState, useRef, useEffect } from 'react';

export const ZoomableDiv = ({
    children,
}: {
    children: React.ReactNode;
}) => {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const initialTranslateX = useRef(0);
  const initialTranslateY = useRef(0);

  const handleWheel = (e: any) => {
    if (e.ctrlKey || e.metaKey) {
    //   e.preventDefault(); // Prevent browser zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setScale((prevScale) => {
        const newScale = Math.min(Math.max(prevScale * delta, 0.5), 3);
        return newScale;
      });
    }
  };

  const handleMouseDown = (e: any) => {
    e.preventDefault(); // Prevent text selection
    isDragging.current = true;
    startX.current = e.clientX;
    startY.current = e.clientY;
    initialTranslateX.current = translateX;
    initialTranslateY.current = translateY;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: any) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startX.current;
    const deltaY = e.clientY - startY.current;
    setTranslateX(initialTranslateX.current + deltaX);
    setTranslateY(initialTranslateY.current + deltaY);
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    // Clean up event listeners on component unmount
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const transformStyle = {
    transform: `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      className="w-1/2 pl-4 overflow-hidden fixed right-0 top-20 bottom-0 bg-white"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
    >
      <div className="zoom-content" style={transformStyle}>
        {children}
      </div>
    </div>
  );
};

