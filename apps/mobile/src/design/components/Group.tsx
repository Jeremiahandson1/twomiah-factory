import React from 'react'
import { Card } from './Card'

/** A card whose children are ListRows (edge to edge, hairlines between). The last row's divider is the caller's `divider={false}`. */
export function Group({ children }: { children: React.ReactNode }) { return <Card padded={false}>{children}</Card> }
