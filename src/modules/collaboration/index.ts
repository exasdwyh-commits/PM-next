// Module collaboration: Feedback disposition, revision tasks, and comments
export interface CreateFeedbackInput {
  projectId: string;
  targetType: string;
  targetId: string;
  targetVersion?: string;
  authorId: string;
  content: string;
}
