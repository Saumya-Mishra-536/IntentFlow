export interface User {
  id: string;
  email: string;
  name?: string | null;
  password?: string | null;
  created_at: Date;
  updated_at: Date;
}
