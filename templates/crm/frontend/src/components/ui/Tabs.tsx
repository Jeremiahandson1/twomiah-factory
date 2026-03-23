import React, { createContext, useContext, useState } from 'react';
import clsx from 'clsx';

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProps {
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function Tabs({ children, defaultValue, value, onChange }: TabsProps) {
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? '');
  const currentValue = value ?? internalValue;

  const handleChange = (newValue: string): void => {
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

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div className={clsx(
      'flex gap-1 p-1 bg-slate-800/50 rounded-lg',
      className
    )}>
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

export function TabsTrigger({ children, value, className }: TabsTriggerProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');
  const { value: currentValue, onChange } = context;
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

interface TabsContentProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

export function TabsContent({ children, value, className }: TabsContentProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');
  const { value: currentValue } = context;

  if (currentValue !== value) return null;

  return (
    <div className={clsx('mt-4', className)}>
      {children}
    </div>
  );
}
