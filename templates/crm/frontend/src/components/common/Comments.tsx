import { useState, useEffect } from 'react';
import { 
  MessageCircle, Send, MoreVertical, Edit2, Trash2, 
  ThumbsUp, Reply, Loader2, User 
} from 'lucide-react';
import api from '../../services/api';

/**
 * Comments Section
 * 
 * Usage:
 *   <Comments entityType="project" entityId={projectId} />
 */
export default function Comments({ entityType, entityId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);

  useEffect(() => {
    loadComments();
  }, [entityType, entityId]);

  const loadComments = async () => {
    try {
      const data = await api.get(`/comments/${entityType}/${entityId}`);
      setComments(data);
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setSubmitting(true);
    try {
      const comment = await api.post(`/comments/${entityType}/${entityId}`, {
        content: newComment,
        parentId: replyingTo,
      });

      if (replyingTo) {
        // Add reply to parent comment
        setComments(prev => prev.map(c => 
          c.id === replyingTo 
            ? { ...c, replies: [...(c.replies || []), comment] }
            : c
        ));
      } else {
        setComments(prev => [comment, ...prev]);
      }

      setNewComment('');
      setReplyingTo(null);
    } catch (error) {
      alert('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (!confirm('Delete this comment?')) return;

    try {
      await api.delete(`/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (error) {
      alert('Failed to delete comment');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Comment form */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-gray-500" />
        </div>
        <div className="flex-1">
          {replyingTo && (
            <div className="text-sm text-gray-500 mb-1 flex items-center gap-2">
              <Reply className="w-3 h-3" />
              Replying to comment
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="text-orange-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={replyingTo ? 'Write a reply...' : 'Write a comment...'}
              className="flex-1 px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              type="submit"
              disabled={!newComment.trim() || submitting}
              className="p-2 bg-orange-500 text-white rounded-full hover:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Comments list */}
      {comments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No comments yet. Be the first!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onDelete={handleDelete}
              onReply={(id) => setReplyingTo(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({ comment, onDelete, onReply, isReply = false }) {
  const [showMenu, setShowMenu] = useState(false);
  const [liked, setLiked] = useState(false);

  const handleLike = async () => {
    try {
      await api.post(`/comments/${comment.id}/react`, { reaction: 'like' });
      setLiked(!liked);
    } catch (error) {
      console.error('Failed to react:', error);
    }
  };

  return (
    <div className={`flex gap-3 ${isReply ? 'ml-12' : ''}`}>
      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
        <span className="text-orange-600 font-medium text-sm">
          {comment.user?.firstName?.[0]}{comment.user?.lastName?.[0]}
        </span>
      </div>
      <div className="flex-1">
        <div className="bg-gray-100 rounded-2xl px-4 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-900">
              {comment.user?.firstName} {comment.user?.lastName}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(comment.createdAt).toLocaleDateString()}
              {comment.editedAt && ' (edited)'}
            </span>
          </div>
          <p className="text-gray-700 whitespace-pre-wrap">{comment.content}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 mt-1 ml-2 text-sm">
          <button
            onClick={handleLike}
            className={`flex items-center gap-1 ${liked ? 'text-orange-500' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <ThumbsUp className="w-4 h-4" />
            Like
          </button>
          {!isReply && (
            <button
              onClick={() => onReply(comment.id)}
              className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
            >
              <Reply className="w-4 h-4" />
              Reply
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-1 bg-white border rounded-lg shadow-lg py-1 z-10">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onDelete(comment.id);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-gray-50 w-full text-left"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Replies */}
        {comment.replies?.length > 0 && (
          <div className="mt-3 space-y-3">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                onDelete={onDelete}
                onReply={onReply}
                isReply={true}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Activity Feed Component
 */
export function ActivityFeed({ entityType, entityId, limit = 20 }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActivity();
  }, [entityType, entityId]);

  const loadActivity = async () => {
    try {
      const data = await api.get(`/comments/activity/${entityType}/${entityId}?limit=${limit}`);
      setActivities(data);
    } catch (error) {
      console.error('Failed to load activity:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;
  }

  if (activities.length === 0) {
    return <div className="text-center py-4 text-gray-500 text-sm">No activity yet</div>;
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

function ActivityItem({ activity }) {
  const getActivityIcon = (action) => {
    const icons = {
      created: '🆕',
      updated: '✏️',
      comment_added: '💬',
      status_changed: '🔄',
      assigned: '👤',
      sent: '📤',
      approved: '✅',
      paid: '💰',
      signed: '✍️',
      completed: '🎉',
      photo_added: '📷',
      file_uploaded: '📎',
    };
    return icons[action] || '•';
  };

  const formatAction = (activity) => {
    const { action, metadata, user } = activity;
    const name = user ? `${user.firstName} ${user.lastName}` : 'Someone';

    const formats = {
      created: `${name} created this`,
      updated: `${name} made updates`,
      comment_added: `${name} commented`,
      status_changed: `${name} changed status to ${metadata?.newStatus || ''}`,
      assigned: `${name} assigned to ${metadata?.assigneeName || 'someone'}`,
      sent: `${name} sent`,
      approved: `Approved by ${name}`,
      paid: 'Payment received',
      signed: `Signed by ${name}`,
      completed: `Marked complete by ${name}`,
      photo_added: `${name} added photos`,
      file_uploaded: `${name} uploaded a file`,
    };

    return formats[action] || `${name} performed ${action}`;
  };

  return (
    <div className="flex items-start gap-3">
      <span className="text-lg">{getActivityIcon(activity.action)}</span>
      <div className="flex-1">
        <p className="text-sm text-gray-700">{formatAction(activity)}</p>
        <p className="text-xs text-gray-400">
          {new Date(activity.createdAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/**
 * Global Activity Feed (for dashboard)
 */
export function GlobalActivityFeed({ limit = 20 }) {
  const [data, setData] = useState({ activities: [], pagination: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFeed();
  }, []);

  const loadFeed = async () => {
    try {
      const result = await api.get(`/comments/activity/feed?limit=${limit}`);
      setData(result);
    } catch (error) {
      console.error('Failed to load activity feed:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-3">
      {data.activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg">
          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm">
            {activity.user?.firstName?.[0]}{activity.user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900">
              <span className="font-medium">{activity.user?.firstName} {activity.user?.lastName}</span>
              {' '}{activity.action.replace(/_/g, ' ')}{' '}
              <span className="text-gray-500">{activity.entityType}</span>
            </p>
            <p className="text-xs text-gray-400">
              {new Date(activity.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
