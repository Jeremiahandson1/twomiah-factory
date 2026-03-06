// Wisconsin DOJ WORCS SOAP Integration for background checks

const WORCS_ENDPOINT = 'https://worcs-services.doj.wi.gov/Worcs.svc'

interface WORCSCredentials {
  username: string
  password: string
  accountNumber: string
}

interface ApplicantData {
  firstName: string
  lastName: string
  dateOfBirth: string
  ssn: string
  requestPurpose?: string
}

const escapeXml = (str: string | undefined): string => {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const buildSOAPRequest = (credentials: WORCSCredentials, applicantData: ApplicantData): string => {
  const { username, password, accountNumber } = credentials
  const { firstName, lastName, dateOfBirth, ssn, requestPurpose = 'Caregiver-General' } = applicantData

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wor="http://worcs.doj.wi.gov/">
  <soap:Header>
    <wor:AuthHeader>
      <wor:Username>${escapeXml(username)}</wor:Username>
      <wor:Password>${escapeXml(password)}</wor:Password>
      <wor:AccountNumber>${escapeXml(accountNumber)}</wor:AccountNumber>
    </wor:AuthHeader>
  </soap:Header>
  <soap:Body>
    <wor:SubmitNameBasedRequest>
      <wor:request>
        <wor:FirstName>${escapeXml(firstName)}</wor:FirstName>
        <wor:LastName>${escapeXml(lastName)}</wor:LastName>
        <wor:DateOfBirth>${dateOfBirth}</wor:DateOfBirth>
        <wor:SSN>${ssn}</wor:SSN>
        <wor:RequestPurpose>${requestPurpose}</wor:RequestPurpose>
        <wor:RequesterReference>${Date.now()}</wor:RequesterReference>
      </wor:request>
    </wor:SubmitNameBasedRequest>
  </soap:Body>
</soap:Envelope>`
}

const buildResultsSOAP = (credentials: WORCSCredentials, referenceNumber: string): string => {
  const { username, password, accountNumber } = credentials
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wor="http://worcs.doj.wi.gov/">
  <soap:Header>
    <wor:AuthHeader>
      <wor:Username>${escapeXml(username)}</wor:Username>
      <wor:Password>${escapeXml(password)}</wor:Password>
      <wor:AccountNumber>${escapeXml(accountNumber)}</wor:AccountNumber>
    </wor:AuthHeader>
  </soap:Header>
  <soap:Body>
    <wor:GetRequestResults>
      <wor:referenceNumber>${escapeXml(referenceNumber)}</wor:referenceNumber>
    </wor:GetRequestResults>
  </soap:Body>
</soap:Envelope>`
}

const parseSOAPResponse = (xml: string) => {
  const refMatch = xml.match(/<ReferenceNumber[^>]*>([^<]+)<\/ReferenceNumber>/i)
  const statusMatch = xml.match(/<Status[^>]*>([^<]+)<\/Status>/i)
  const errorMatch = xml.match(/<ErrorMessage[^>]*>([^<]+)<\/ErrorMessage>/i)
  const resultMatch = xml.match(/<Result[^>]*>([^<]+)<\/Result>/i)
  const recordMatch = xml.match(/<HasRecord[^>]*>([^<]+)<\/HasRecord>/i)

  return {
    referenceNumber: refMatch ? refMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    result: resultMatch ? resultMatch[1].trim() : null,
    hasRecord: recordMatch ? recordMatch[1].trim().toLowerCase() === 'true' : null,
    error: errorMatch ? errorMatch[1].trim() : null,
    rawXml: xml,
  }
}

export const submitBackgroundCheck = async (applicantData: ApplicantData) => {
  const credentials: WORCSCredentials = {
    username: process.env.WORCS_USERNAME || '',
    password: process.env.WORCS_PASSWORD || '',
    accountNumber: process.env.WORCS_ACCOUNT_NUMBER || '',
  }

  if (!credentials.username || !credentials.password) {
    console.warn('[WORCS] No credentials configured - returning mock pending response')
    return {
      success: true,
      referenceNumber: `MOCK-${Date.now()}`,
      status: 'pending',
      mock: true,
    }
  }

  try {
    const soapBody = buildSOAPRequest(credentials, applicantData)

    const response = await fetch(WORCS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://worcs.doj.wi.gov/IWorcs/SubmitNameBasedRequest',
      },
      body: soapBody,
      signal: AbortSignal.timeout(30000),
    })

    const xml = await response.text()
    const parsed = parseSOAPResponse(xml)

    if (parsed.error) {
      throw new Error(`WORCS Error: ${parsed.error}`)
    }

    return {
      success: true,
      referenceNumber: parsed.referenceNumber,
      status: 'pending',
    }
  } catch (error: any) {
    console.error('[WORCS] Submit error:', error.message)
    throw new Error(`Background check submission failed: ${error.message}`)
  }
}

export const getCheckResults = async (referenceNumber: string) => {
  if (referenceNumber.startsWith('MOCK-')) {
    return {
      referenceNumber,
      status: 'completed',
      result: 'cleared',
      hasRecord: false,
      completedAt: new Date().toISOString(),
      mock: true,
    }
  }

  const credentials: WORCSCredentials = {
    username: process.env.WORCS_USERNAME || '',
    password: process.env.WORCS_PASSWORD || '',
    accountNumber: process.env.WORCS_ACCOUNT_NUMBER || '',
  }

  if (!credentials.username) {
    throw new Error('WORCS credentials not configured')
  }

  try {
    const soapBody = buildResultsSOAP(credentials, referenceNumber)

    const response = await fetch(WORCS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://worcs.doj.wi.gov/IWorcs/GetRequestResults',
      },
      body: soapBody,
      signal: AbortSignal.timeout(30000),
    })

    const xml = await response.text()
    const parsed = parseSOAPResponse(xml)

    let result = 'pending'
    if (parsed.status === 'Completed' || parsed.status === 'Complete') {
      result = parsed.hasRecord ? 'record_found' : 'cleared'
    } else if (parsed.status === 'Error' || parsed.status === 'Failed') {
      result = 'error'
    }

    return {
      referenceNumber,
      status: parsed.status === 'Completed' ? 'completed' : 'pending',
      result,
      hasRecord: parsed.hasRecord,
      rawResult: parsed.result,
      completedAt: result !== 'pending' ? new Date().toISOString() : null,
    }
  } catch (error: any) {
    console.error('[WORCS] Results error:', error.message)
    throw new Error(`Failed to retrieve results: ${error.message}`)
  }
}
