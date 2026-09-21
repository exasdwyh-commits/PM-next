// Module products: Product identity, immutable versions and specs
export interface CreateProductVersionInput {
  productId: string;
  versionTag: string;
  specs: Record<string, any>;
  technicalAdvice?: string;
  experienceGoals?: string;
  targetCost?: number;
  currency?: string;
  unknowns?: Record<string, any>;
}
