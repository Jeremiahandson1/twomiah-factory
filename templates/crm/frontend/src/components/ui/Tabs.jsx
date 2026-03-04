import React, { createContext, useContext, useState } from 'react';
import clsx from 'clsx';

const TabsContext = createContext();

export function Tabs({ children, defaultValue, value, onChange }) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = value ?? internalValue;
  
  const handleChange = (newValue) => {
    if (onChange) {
      onChange(newValue);
    } else {
      setInternalValue(newValue);
    }
  };

  return (
    <TabsContext.Provider value={{ value: currentValue, onChange: handleChange }}>
      {children}
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }) {
  return (
    <div className={clsx(
      'flex gap-1 p-1 bg-slate-800/50 rounded-lg',
      className
    )}>
      {children}
    </div>
  );
}

export function TabsTrigger({ children, value, className }) {
  const { value: currentValue, onChange } = useContext(TabsContext);
  const isActive = currentValue === value;

  return (
    <button
      onClick={() => onChange(value)}
      className={clsx(
        'px-4 py-2 text-sm font-medium rounded-md transition-all',
        isActive 
          ? 'bg-slate-700 text-white shadow' 
          : 'text-slate-400 hover:text-white hover:bg-slate-700/50',
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ children, value, className }) {
  const { value: currentValue } = useContext(TabsContext);
  
  if (currentValue !== value) return null;

  return (
    <div className={clsx('mt-4', className)}>
      {children}
    </div>
  );
}
