import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Building, Check, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function SignupSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const verifyCheckout = async () => {
      const sessionId = searchParams.get('session_id');
      const token = sessionStorage.getItem('signup_token');

      if (!sessionId) {
        // No session ID means they came from free trial flow
        if (token) {
          localStorage.setItem('token', token);
          sessionStorage.removeItem('signup_token');
          sessionStorage.removeItem('signup_company_id');
        }
        setLoading(false);
        return;
      }

      try {
        // Verify the checkout session
        const response = await fetch(`${API_URL}/api/billing/checkout/success?session_id=${sessionId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to verify checkout');
        }

        // Store the token and clean up
        if (token) {
          localStorage.setItem('token', token);
          sessionStorage.removeItem('signup_token');
          sessionStorage.removeItem('signup_company_id');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    verifyCheckout();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Setting up your account...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-500 text-2xl">!</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link
            to="/signup"
            className="inline-block bg-orange-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-orange-600"
          >
            Try Again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
              <Building className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-gray-900">Twomiah Build</span>
          </Link>
        </div>
      </header>

      {/* Success Content */}
      <main className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-green-500" />
          </div>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Welcome to Twomiah Build!
          </h1>
          <p className="text-gray-600 mb-8 text-lg">
            Your account has been created successfully. You're ready to start managing your business.
          </p>

          <div className="bg-gray-50 rounded-lg p-6 mb-8 text-left">
            <h2 className="font-semibold text-gray-900 mb-4">What's Next?</h2>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-orange-500 text-sm font-bold">1</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Add your first contact</p>
                  <p className="text-sm text-gray-500">Import your customer list or add contacts manually</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-orange-500 text-sm font-bold">2</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Set up your company profile</p>
                  <p className="text-sm text-gray-500">Add your logo, business hours, and service areas</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-orange-500 text-sm font-bold">3</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Create your first job</p>
                  <p className="text-sm text-gray-500">Schedule work and start tracking your projects</p>
                </div>
              </li>
            </ul>
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full bg-orange-500 text-white py-4 rounded-lg font-semibold hover:bg-orange-600 text-lg"
          >
            Go to Dashboard
          </button>

          <p className="text-gray-500 text-sm mt-6">
            Need help getting started?{' '}
            <a href="/docs" className="text-orange-500 hover:underline">View our guides</a>
            {' '}or{' '}
            <a href="/support" className="text-orange-500 hover:underline">contact support</a>
          </p>
        </div>
      </main>
    </div>
  );
}
